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
    MessageFlags,
    Partials
} = require('discord.js');

// Kategorie – ustaw odpowiednie ID kategorii
const TICKET_CATEGORY_OPEN    = '1350857928583807039';
const TICKET_CATEGORY_CLOSED  = '1350857964675661885';

// ID roli administracji
const ADMIN_ROLE_ID           = '1350176648368230601';

// ID kanału powitalnego i regulaminu
const WELCOME_CHANNEL_ID      = '1348705958939066393';
const REGULAMIN_CHANNEL_ID    = '1348705958939066396';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// map: messageId → { emojiKey → { roleId, singleChoice } }
const dynamicReactionRoleMap = new Map();

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
    client.user.setActivity("cinamoinka", {
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/cinamoinka"
    });
});

// helper: dodaje stopkę do embeda
function withFooter(embed) {
    return embed.setFooter({ text: '© tajgerek' });
}

client.on('guildMemberAdd', async member => {
    try {
        const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
        if (!ch?.isTextBased()) return;

        const welcomeEmbed = withFooter(
            new EmbedBuilder()
                .setTitle('🎉 Witamy na serwerze! 🎉')
                .setDescription(`Witaj <@${member.id}>!\n\nCieszymy się, że dołączyłeś do naszej społeczności. Zapoznaj się z regulaminem, aby w pełni korzystać z serwera.`)
                .addFields(
                    { name: 'Nazwa użytkownika',    value: member.user.username, inline: true },
                    { name: 'Data utworzenia konta', value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setColor(0x00AE86)
                .setTimestamp()
        );

        const regulaminButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('📜 Regulamin')
            .setURL(`https://discord.com/channels/${member.guild.id}/${REGULAMIN_CHANNEL_ID}`);

        await ch.send({ embeds: [welcomeEmbed], components: [ new ActionRowBuilder().addComponents(regulaminButton) ] });
    } catch (err) {
        console.error("Błąd w guildMemberAdd:", err);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // ===== REACTION ROLES =====
    if (message.content === '!reaction roles') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.channel.send('Tylko administratorzy mogą tworzyć reaction roles.');
        }

        const filter = m => m.author.id === message.author.id;
        const ask = async prompt => {
            await message.channel.send(prompt);
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
            return collected?.first()?.content;
        };

        // 1) wybór kanału
        await message.channel.send('Wskaż kanał do wysłania embeda (wspomnij kanał).');
        const target = message.mentions.channels.first();
        if (!target) return message.channel.send('Nieprawidłowy kanał.');

        // 2) tytuł
        const title     = await ask('Podaj tytuł embeda:');
        if (!title) return message.channel.send('Brak tytułu, anulowano.');

        // 3) treść
        const embedText = await ask('Podaj treść embeda:');
        if (!embedText) return message.channel.send('Brak treści, anulowano.');

        // 4) single choice?
        const singleAns = await ask('Czy to będzie wybór jednokrotnego wyboru (tak/nie)?');
        if (!singleAns) return message.channel.send('Brak odpowiedzi, anulowano.');
        const singleChoice = singleAns.toLowerCase() === 'tak';

        // 5) pary emoji → rola
        const pairs = [];
        await message.channel.send('Podaj parę `:emotka: @rola`. Napisz `koniec` aby zakończyć.');
        while (true) {
            const entry = await ask('');
            if (!entry) return message.channel.send('Czas minął, anulowano.');
            if (entry.toLowerCase() === 'koniec') break;

            const match = entry.match(/(<a?:\w+:(\d+)>|\p{Emoji_Presentation})\s+<@&(\d+)>/u);
            if (!match) {
                await message.channel.send('Zły format, podaj `:emotka: @rola`.');
                continue;
            }
            pairs.push({ emoji: match[1], roleId: match[3] });
        }

        // 6) kolor
        const color = await ask('Podaj kod koloru hex (np. #FF0000):');
        if (!color) return message.channel.send('Brak koloru, anulowano.');

        // Stworzenie embeda
        const rrEmbed = withFooter(
            new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(embedText)
        );

        // Wysłanie i reakcje
        const sent = await target.send({ embeds: [rrEmbed] });
        dynamicReactionRoleMap.set(sent.id, {});
        for (const { emoji, roleId } of pairs) {
            await sent.react(emoji).catch(() => {});
            const key = emoji.match(/<a?:\w+:(\d+)>/)?.[1] || emoji;
            dynamicReactionRoleMap.get(sent.id)[key] = { roleId, singleChoice };
        }

        return;
    }

    // ===== TICKETY =====
    if (message.content.startsWith('$ticket zglos') || message.content.startsWith('$ticket pomoc')) {
        const isReport = message.content.startsWith('$ticket zglos');
        const embed = withFooter(
            new EmbedBuilder()
                .setTitle(isReport ? 'ZGŁOŚ UŻYTKOWNIKA' : 'ZGŁOŚ PROBLEM')
                .setDescription(isReport ? 'Kliknij przycisk, aby zgłosić użytkownika.' : 'Kliknij przycisk, aby zgłosić problem.')
                .setColor(isReport ? 0xFF0000 : 0x00AE86)
        );
        const button = new ButtonBuilder()
            .setCustomId(isReport ? 'create_ticket_zglos' : 'create_ticket_pomoc')
            .setLabel(isReport ? '⚠️ zgłoś użytkownika' : '🔨 zgłoś problem')
            .setStyle(isReport ? ButtonStyle.Danger : ButtonStyle.Primary);

        return message.channel.send({ embeds: [embed], components: [ new ActionRowBuilder().addComponents(button) ] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    // Obsługa tworzenia ticketu
    if (interaction.customId === 'create_ticket_zglos' || interaction.customId === 'create_ticket_pomoc') {
        const isReport = interaction.customId === 'create_ticket_zglos';
        const channelName = `${isReport ? 'zglos' : 'pomoc'}-${interaction.user.username}`;

        try {
            const ticketCh = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_OPEN,
                permissionOverwrites: [
                    { id: interaction.guild.id,                           deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id,                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: ADMIN_ROLE_ID,                                  allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ]
            });

            await ticketCh.send(`<@${interaction.user.id}>`);

            const ticketEmbed = withFooter(
                new EmbedBuilder()
                    .setTitle(isReport ? 'ZGŁOŚ UŻYTKOWNIKA' : 'ZGŁOŚ PROBLEM')
                    .setDescription(isReport ? 'Opisz użytkownika i powód.' : 'Opisz swój problem.')
                    .setColor(isReport ? 0xFF0000 : 0x00AE86)
            );
            const closeBtn = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij Ticket')
                .setStyle(ButtonStyle.Danger);

            await ticketCh.send({ embeds: [ticketEmbed], components: [ new ActionRowBuilder().addComponents(closeBtn) ] });
            await interaction.reply({ content: `Ticket utworzony: ${ticketCh}`, ephemeral: true });
        } catch (err) {
            console.error('Błąd tworzenia ticketu:', err);
            await interaction.reply({ content: 'Błąd tworzenia ticketa.', ephemeral: true });
        }
        return;
    }

    // Zamknięcie ticketu
    if (interaction.customId === 'close_ticket') {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: 'Brak uprawnień.', ephemeral: true });
        }
        await interaction.channel.setParent(TICKET_CATEGORY_CLOSED);
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
        return interaction.reply('Ticket zamknięty.');
    }
});

// ===== REACTION ROLES HANDLER =====
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); }
        catch { return; }
    }
    const msgId = reaction.message.id;
    if (!dynamicReactionRoleMap.has(msgId)) return;

    const key = reaction.emoji.id || reaction.emoji.toString();
    const data = dynamicReactionRoleMap.get(msgId)[key];
    if (!data) return;

    const member = await reaction.message.guild.members.fetch(user.id);

    if (data.singleChoice) {
        // usuwamy inne single-choice role z tego embedu
        for (const [k, v] of Object.entries(dynamicReactionRoleMap.get(msgId))) {
            if (v.singleChoice && v.roleId !== data.roleId && member.roles.cache.has(v.roleId)) {
                await member.roles.remove(v.roleId).catch(() => {});
            }
        }
    }

    if (!member.roles.cache.has(data.roleId)) {
        await member.roles.add(data.roleId).catch(() => {});
    }
});

client.login(process.env.TOKEN);
