const { 
    Client, 
    GatewayIntentBits, 
    ActivityType, 
    PermissionsBitField, 
    ChannelType, 
    EmbedBuilder, 
    ButtonBuilder, 
    ActionRowBuilder, 
    ButtonStyle,
    MessageFlags
} = require('discord.js');

// Kategorie – ustaw odpowiednie ID kategorii
const TICKET_CATEGORY_OPEN   = '1350857928583807039';
const TICKET_CATEGORY_CLOSED = '1350857964675661885';

// ID roli administracji – wstaw właściwy identyfikator
const ADMIN_ROLE_ID = '1350176648368230601';

// ID kanału powitalnego
const WELCOME_CHANNEL_ID = '1348705958939066393';

// ID kanału z regulaminem
const REGULAMIN_CHANNEL_ID = '1348705958939066396';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION']
});

// Dynamiczne mapowanie emotek na role (ustawiane przez !reaction roles)
let dynamicReactionRoleMap = {};

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
    client.user.setActivity("cinamoinka", {
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/cinamoinka"
    });
});

// ----- POWITANIE -----
client.on('guildMemberAdd', async member => {
    try {
        const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
        if (welcomeChannel?.isTextBased()) {
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎉 Witamy na serwerze! 🎉')
                .setDescription(
`Witaj <@${member.id}>!

Cieszymy się, że dołączyłeś do naszej społeczności. Zapoznaj się z regulaminem.`)
                .addFields(
                    { name: 'Nazwa użytkownika', value: member.user.username, inline: true },
                    { name: 'Data utworzenia konta', value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: '© tajgerek' });

            const regulaminButton = new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('📜 regulamin')
                .setURL(`https://discord.com/channels/${member.guild.id}/${REGULAMIN_CHANNEL_ID}`);

            const row = new ActionRowBuilder().addComponents(regulaminButton);
            await welcomeChannel.send({ embeds: [welcomeEmbed], components: [row] });
        }
    } catch (error) {
        console.error("Błąd przy wysyłaniu wiadomości powitalnej:", error);
    }
});

// ----- KOMENDY TEKSTOWE -----
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const { content, member, channel, guild } = message;

    // --- 1) Reaction Roles ---
    if (content === '!reaction roles') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply('Tylko administratorzy mogą tworzyć reaction roles.');

        const filter = m => m.author.id === message.author.id;

        // 1. Kanał
        await channel.send('Wskaż kanał do wysłania embeda (wspomnij kanał).');
        let collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] }).catch(() => null);
        if (!collected) return channel.send('Czas minął, anulowano.');
        const target = collected.first().mentions.channels.first();
        if (!target) return channel.send('Nieprawidłowy kanał.');

        // 2. Treść embeda
        await channel.send('Podaj treść wiadomości embeda:');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] }).catch(() => null);
        if (!collected) return channel.send('Brak treści, anulowano.');
        const embedText = collected.first().content;

        // 3. Emotikony + role
        const pairs = [];
        await channel.send('Podaj parę `:emotka: @rola`. Napisz `koniec` aby zakończyć.');
        while (true) {
            collected = await channel.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] }).catch(() => null);
            if (!collected) return channel.send('Czas minął, anulowano.');
            const entry = collected.first().content.trim();
            if (entry.toLowerCase() === 'koniec') break;
            const match = entry.match(/(<a?:\w+:(\d+)>|\p{Emoji_Presentation})\s+<@&(\d+)>/u);
            if (!match) { 
                await channel.send('Zły format, podaj `:emotka: @rola`.'); 
                continue; 
            }
            pairs.push({ emoji: match[1], roleId: match[3] });
        }

        // 4. Kolor embeda
        await channel.send('Podaj kod koloru hex (np. #FF0000):');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] }).catch(() => null);
        if (!collected) return channel.send('Brak koloru, anulowano.');
        const color = collected.first().content.trim();

        // Tworzenie embeda
        const rrEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle('Reaction Roles')
            .setDescription(embedText);

        for (const { emoji, roleId } of pairs) {
            rrEmbed.addFields({ name: emoji, value: `<@&${roleId}>`, inline: true });
            const idMatch = emoji.match(/<a?:\w+:(\d+)>/);
            if (idMatch) dynamicReactionRoleMap[idMatch[1]] = roleId;
            else dynamicReactionRoleMap[emoji] = roleId;
        }

        const sent = await target.send({ embeds: [rrEmbed] });
        for (const { emoji } of pairs) {
            await sent.react(emoji).catch(() => {});
        }
        return;
    }

    // --- 2) Ticket: zgłoś użytkownika ---
    if (content.startsWith('$ticket zglos')) {
        const embed = new EmbedBuilder()
            .setTitle("ZGŁOŚ UŻYTKOWNIKA")
            .setDescription("Jeśli uważasz, że użytkownik łamie regulamin, kliknij poniższy przycisk.")
            .setColor(0xFF0000)
            .setFooter({ text: '© tajgerek' });
        const button = new ButtonBuilder()
            .setCustomId('create_ticket_zglos')
            .setLabel('⚠️ zgłoś użytkownika')
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(button);
        await channel.send({ embeds: [embed], components: [row] });
        return;
    }

    // --- 3) Ticket: pomoc techniczna ---
    if (content.startsWith('$ticket pomoc')) {
        const embed = new EmbedBuilder()
            .setTitle("ZGŁOŚ PROBLEM")
            .setDescription("Jeśli masz problem techniczny, kliknij poniższy przycisk.")
            .setColor(0x00AE86)
            .setFooter({ text: '© tajgerek' });
        const button = new ButtonBuilder()
            .setCustomId('create_ticket_pomoc')
            .setLabel('🔨 zgłoś problem')
            .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(button);
        await channel.send({ embeds: [embed], components: [row] });
        return;
    }
});

// ----- OBSŁUGA BUTTONÓW (TICKETY) -----
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const username = interaction.user.username;
    const prefix = interaction.customId === 'create_ticket_zglos' ? 'zglos' : 'pomoc';
    const channelName = `${prefix}-${username}`;

    if (interaction.customId === 'create_ticket_zglos' || interaction.customId === 'create_ticket_pomoc') {
        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_OPEN,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]},
                    { id: ADMIN_ROLE_ID, allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]}
                ]
            });

            await ticketChannel.send({ 
                content: `<@${interaction.user.id}>`, 
                allowedMentions: { users: [interaction.user.id] } 
            });

            const isReport = interaction.customId === 'create_ticket_zglos';
            const ticketEmbed = new EmbedBuilder()
                .setTitle(isReport ? "ZGŁOŚ UŻYTKOWNIKA" : "ZGŁOŚ PROBLEM")
                .setDescription(isReport 
                    ? "Podaj nick użytkownika i powód zgłoszenia." 
                    : "Opisz swój problem." )
                .setColor(isReport ? 0xFF0000 : 0x00AE86)
                .setFooter({ text: '© tajgerek' });

            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij Ticket')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(closeButton);
            await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });
            await interaction.reply({ content: `Ticket utworzony: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error("Błąd przy tworzeniu ticketa:", error);
            await interaction.reply({ content: "Wystąpił błąd.", flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.customId === 'close_ticket') {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: "Tylko admin może zamknąć.", flags: MessageFlags.Ephemeral });
        }
        const ticketChannel = interaction.channel;
        await ticketChannel.setParent(TICKET_CATEGORY_CLOSED);
        await ticketChannel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
        await interaction.reply("Ticket został zamknięty.");
    }
});

// ----- OBSŁUGA REAKCJI (REACTION ROLES) -----
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); }
        catch { return; }
    }
    if (!reaction.message.guild) return;

    const key = reaction.emoji.id || reaction.emoji.toString();
    const roleId = dynamicReactionRoleMap[key];
    if (roleId) {
        const member = await reaction.message.guild.members.fetch(user.id);
        if (!member.roles.cache.has(roleId)) {
            member.roles.add(roleId).catch(() => {});
        }
    }
});

// ----- URUCHOMIENIE BOTA -----
client.login(process.env.TOKEN);
