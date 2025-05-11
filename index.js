const { Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers // potrzebny do events.guildMemberAdd:contentReference[oaicite:4]{index=4}
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const prefix = '$';
const supportRoleId = 'SUPPORT_ROLE_ID';       // ID roli wsparcia (podaj prawidłową)
const ticketCategoryId = 'TICKET_CATEGORY_ID'; // ID kategorii "Tickets" (opcjonalnie)
const welcomeChannelId = 'WELCOME_CHANNEL_ID'; // ID kanału powitalnego
const dynamicReactionRoleMap = new Map(); // mapa: messageId -> { emojiKey, emojiId, roleId }

// Po włączeniu bota
client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
});

// Obsługa komend tekstowych
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Komenda $rr: tworzy wiadomość z reaction role
    if (command === 'rr') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            message.reply('Nie masz uprawnień do zarządzania rolami.');
            return;
        }
        const emoji = args[0];
        const roleArg = args[1];
        const embedText = args.slice(2).join(' ');

        if (!emoji || !roleArg || !embedText) {
            message.reply('Użycie: `$rr <emoji> <rola> <tekst embed>`');
            return;
        }
        // Parsowanie roli z wzmianki lub ID
        let role;
        const roleIdMatch = roleArg.match(/^<@&(\d+)>$/);
        if (roleIdMatch) {
            role = message.guild.roles.cache.get(roleIdMatch[1]);
        } else {
            role = message.guild.roles.cache.get(roleArg);
        }
        if (!role) {
            message.reply('Nie znaleziono takiej roli.');
            return;
        }

        // Tworzymy embed z podanym tekstem
        const embed = new EmbedBuilder()
            .setColor('#00AAFF')
            .setDescription(embedText);
        const botMsg = await message.channel.send({ embeds: [embed] });

        // Dodajemy reakcję (emoji może być zwykłe lub niestandardowe)
        try {
            await botMsg.react(emoji);
        } catch (err) {
            console.error('Nie udało się dodać reakcji:', err);
        }

        // Zapisujemy mapping: messageId -> emoji-role
        let emojiKey = null, emojiId = null;
        // Jeśli emoji niestandardowe (w formacie <a:name:id> albo <:name:id>)
        if (emoji.startsWith('<') && emoji.endsWith('>') && emoji.includes(':')) {
            const parts = emoji.split(':');
            emojiId = parts[2].slice(0, -1); // wyciągamy ID
        } else {
            // Emoji unicode (np. 😄)
            emojiKey = emoji;
        }
        dynamicReactionRoleMap.set(botMsg.id, { emojiKey, emojiId, roleId: role.id });
        message.reply('Wiadomość reaction-role została utworzona!');
    }

    // Komenda $ticket: otwórz nowy ticket (kanał tekstowy)
    if (command === 'ticket') {
        // Sprawdź czy już istnieje ticket od tego użytkownika
        const existing = message.guild.channels.cache.find(ch => ch.name === `ticket-${message.author.id}`);
        if (existing) {
            message.reply('Masz już otwarty ticket.');
            return;
        }
        // Tworzymy nazwę kanału i jego uprawnienia
        const channelName = `ticket-${message.author.id}`;
        const overwrites = [
            {
                id: message.guild.id, // @everyone
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: message.author.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
        ];
        // Jeśli podano rolę wsparcia, dajemy jej dostęp
        if (supportRoleId) {
            overwrites.push({
                id: supportRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            });
        }
        // Tworzymy kanał, opcjonalnie w kategorii
        const options = { name: channelName, type: ChannelType.GuildText, permissionOverwrites: overwrites };
        if (ticketCategoryId) {
            options.parent = ticketCategoryId;
        }
        const ticketChannel = await message.guild.channels.create(options);
        ticketChannel.send(`Witaj <@${message.author.id}>, utworzono ticket. Opisz swój problem.`)
            .catch(console.error);
        message.reply(`Twój ticket został utworzony: <#${ticketChannel.id}>`);
    }

    // Komenda $close: usuwa aktualny kanał ticket (tylko wewnątrz ticketów)
    if (command === 'close') {
        if (!message.channel.name.startsWith('ticket-')) return;
        const ticketOwnerId = message.channel.name.split('ticket-')[1];
        if (message.author.id !== ticketOwnerId && !message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            message.reply('Nie możesz zamknąć tego ticketu.');
            return;
        }
        message.channel.send('Zamykanie ticketu...').then(() => {
            message.channel.delete().catch(console.error);
        });
    }
});

// Obsługa reakcji na wiadomościach z reaction-role
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }
    // Tylko reakcje na wiadomości wysłane przez tego bota i zarejestrowane
    if (reaction.message.author.id !== client.user.id) return;
    const mapping = dynamicReactionRoleMap.get(reaction.message.id);
    if (!mapping) return;

    // Sprawdzamy, czy emoji pasuje do zapisanego
    let match = false;
    if (mapping.emojiId) {
        match = (reaction.emoji.id === mapping.emojiId);
    } else if (mapping.emojiKey) {
        match = (reaction.emoji.name === mapping.emojiKey);
    }
    if (!match) return;

    // Dodajemy rolę użytkownikowi
    const member = reaction.message.guild.members.cache.get(user.id);
    if (!member) return;
    const role = reaction.message.guild.roles.cache.get(mapping.roleId);
    if (!role) return;
    member.roles.add(role).catch(console.error);
});

// Usuwanie roli po odznaczeniu reakcji (opcjonalnie)
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }
    if (reaction.message.author.id !== client.user.id) return;
    const mapping = dynamicReactionRoleMap.get(reaction.message.id);
    if (!mapping) return;

    let match = false;
    if (mapping.emojiId) {
        match = (reaction.emoji.id === mapping.emojiId);
    } else if (mapping.emojiKey) {
        match = (reaction.emoji.name === mapping.emojiKey);
    }
    if (!match) return;

    const member = reaction.message.guild.members.cache.get(user.id);
    if (!member) return;
    const role = reaction.message.guild.roles.cache.get(mapping.roleId);
    if (!role) return;
    member.roles.remove(role).catch(console.error);
});

// Powitanie nowego członka serwera
client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.get(welcomeChannelId);
    if (!channel) return;
    const welcomeEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Witamy na serwerze!')
        .setDescription(`Cześć ${member.user}, cieszymy się, że dołączyłeś!`);
    channel.send({ content: `${member}`, embeds: [welcomeEmbed] }).catch(console.error);
});

client.login(process.env.TOKEN);
