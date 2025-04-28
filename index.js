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
const TICKET_CATEGORY_OPEN = '1350857928583807039';
const TICKET_CATEGORY_CLOSED = '1350857964675661885';

// ID roli administracji
const ADMIN_ROLE_ID = '1350176648368230601';

// ID kanału powitalnego i regulaminu
const WELCOME_CHANNEL_ID = '1348705958939066393';
const REGULAMIN_CHANNEL_ID = '1348705958939066396';

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

let dynamicReactionRoleMap = {};

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
    client.user.setActivity("cinamoinka", {
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/cinamoinka"
    });
});

client.on('guildMemberAdd', async member => {
    try {
        const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
        if (welcomeChannel?.isTextBased()) {
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎉 Witamy na serwerze! 🎉')
                .setDescription(`Witaj <@${member.id}>!\n\nCieszymy się, że dołączyłeś do naszej społeczności. Mamy nadzieję, że znajdziesz tu przyjazne środowisko oraz wiele ciekawych rozmów i aktywności. Zapoznaj się z regulaminem i zasadami serwera, aby w pełni korzystać z dostępnych możliwości. Jeszcze raz – witamy serdecznie!`)
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

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const { content, member, channel, guild } = message;

    if (content === '!reaction roles') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator))
            return channel.send('Tylko administratorzy mogą tworzyć reaction roles.');
        const filter = m => m.author.id === message.author.id;

        await channel.send('Wskaż kanał do wysłania embeda (wspomnij kanał).');
        let collected = await channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        if (!collected) return channel.send('Czas minął, anulowano.');
        const target = collected.first().mentions.channels.first();
        if (!target) return channel.send('Nieprawidłowy kanał.');

        await channel.send('Podaj tytuł embeda:');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        if (!collected) return channel.send('Brak tytułu, anulowano.');
        const title = collected.first().content.trim();

        await channel.send('Podaj treść embeda:');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        if (!collected) return channel.send('Brak treści, anulowano.');
        const embedText = collected.first().content;

        await channel.send('Czy to będzie wybór jednokrotnego wyboru (tak/nie)?');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        if (!collected) return channel.send('Brak odpowiedzi, anulowano.');
        const singleChoice = collected.first().content.toLowerCase() === 'tak';

        const pairs = [];
        await channel.send('Podaj parę `:emotka: @rola`. Napisz `koniec` aby zakończyć.');
        while (true) {
            collected = await channel.awaitMessages({ filter, max: 1, time: 120000 }).catch(() => null);
            if (!collected) return channel.send('Czas minął, anulowano.');
            const entry = collected.first().content.trim();
            if (entry.toLowerCase() === 'koniec') break;
            const match = entry.match(/(<a?:\w+:(\d+)>|\p{Emoji_Presentation})\s+<@&(\d+)>/u);
            if (!match) { await channel.send('Zły format, podaj `:emotka: @rola`.'); continue; }
            pairs.push({ emoji: match[1], roleId: match[3] });
        }

        await channel.send('Podaj kod koloru hex (np. #FF0000):');
        collected = await channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        if (!collected) return channel.send('Brak koloru, anulowano.');
        const color = collected.first().content.trim();

        const rrEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(embedText);

        const sent = await target.send({ embeds: [rrEmbed] });
        for (const { emoji, roleId } of pairs) {
            await sent.react(emoji).catch(() => {});
            const idMatch = emoji.match(/<a?:\w+:(\d+)>/);
            if (idMatch) dynamicReactionRoleMap[idMatch[1]] = { roleId, singleChoice };
            else dynamicReactionRoleMap[emoji] = { roleId, singleChoice };
        }
        return;
    }

    if (content.startsWith('$ticket zglos')) {
        const embed = new EmbedBuilder()
            .setTitle("ZGŁOŚ UŻYTKOWNIKA")
            .setDescription("Kliknij przycisk, aby zgłosić użytkownika.")
            .setColor(0xFF0000)
            .setFooter({ text: '© tajgerek' });
        const button = new ButtonBuilder()
            .setCustomId('create_ticket_zglos')
            .setLabel('⚠️ zgłoś użytkownika')
            .setStyle(ButtonStyle.Danger);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
        return;
    }

    if (content.startsWith('$ticket pomoc')) {
        const embed = new EmbedBuilder()
            .setTitle("ZGŁOŚ PROBLEM")
            .setDescription("Kliknij przycisk, aby zgłosić problem.")
            .setColor(0x00AE86)
            .setFooter({ text: '© tajgerek' });
        const button = new ButtonBuilder()
            .setCustomId('create_ticket_pomoc')
            .setLabel('🔨 zgłoś problem')
            .setStyle(ButtonStyle.Primary);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
        return;
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const guild = interaction.guild;
    if (interaction.customId === 'create_ticket_zglos' || interaction.customId === 'create_ticket_pomoc') {
        const prefix = interaction.customId === 'create_ticket_zglos' ? 'zglos' : 'pomoc';
        const channelName = `${prefix}-${interaction.user.username}`;
        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_OPEN,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ]
            });
            await ticketChannel.send(`<@${interaction.user.id}>`);
            const isReport = interaction.customId === 'create_ticket_zglos';
            const ticketEmbed = new EmbedBuilder()
                .setTitle(isReport ? "ZGŁOŚ UŻYTKOWNIKA" : "ZGŁOŚ PROBLEM")
                .setDescription(isReport ? "Opisz użytkownika i powód." : "Opisz swój problem.")
                .setColor(isReport ? 0xFF0000 : 0x00AE86)
                .setFooter({ text: '© tajgerek' });
            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij Ticket')
                .setStyle(ButtonStyle.Danger);
            await ticketChannel.send({ embeds: [ticketEmbed], components: [new ActionRowBuilder().addComponents(closeButton)] });
            await interaction.reply({ content: `Ticket utworzony: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: "Błąd tworzenia ticketa.", flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.customId === 'close_ticket') {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID))
            return interaction.reply({ content: "Brak uprawnień.", flags: MessageFlags.Ephemeral });
        await interaction.channel.setParent(TICKET_CATEGORY_CLOSED);
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
        await interaction.reply("Ticket zamknięty.");
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) try { await reaction.fetch(); } catch { return; }
    if (!reaction.message.guild) return;
    const key = reaction.emoji.id || reaction.emoji.toString();
    const data = dynamicReactionRoleMap[key];
    if (data) {
        const member = await reaction.message.guild.members.fetch(user.id);
        if (data.singleChoice) {
            for (const [emojiKey, value] of Object.entries(dynamicReactionRoleMap)) {
                if (value.roleId !== data.roleId && value.singleChoice) {
                    const roleToRemove = value.roleId;
                    if (member.roles.cache.has(roleToRemove)) {
                        await member.roles.remove(roleToRemove).catch(() => {});
                    }
                }
            }
        }
        if (!member.roles.cache.has(data.roleId)) member.roles.add(data.roleId).catch(() => {});
    }
});

client.login(process.env.TOKEN);
