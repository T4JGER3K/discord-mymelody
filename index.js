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
const TICKET_CATEGORY_OPEN = '1350857928583807039';    // kategoria, do której będą trafiać nowe tickety
const TICKET_CATEGORY_CLOSED = '1350857964675661885';  // kategoria zamkniętych ticketów

// ID roli administracji – wstaw właściwy identyfikator
const ADMIN_ROLE_ID = '1350176648368230601';

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

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
    client.user.setActivity("cinamoinka", {
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/cinamoinka"
    });
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Komenda $ticket zglos
    if (message.content.startsWith('$ticket zglos')) {
        const embed = new EmbedBuilder()
            .setTitle("zglos")
            .setDescription("Kliknij poniższy przycisk, aby zgłosić użytkownika.")
            .setColor(0x00AE86);

        const button = new ButtonBuilder()
            .setCustomId('create_ticket_zglos')
            .setLabel('zgłoś użytkownika')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);
        await message.channel.send({ embeds: [embed], components: [row] });
    }
    // Komenda $ticket pomoc
    else if (message.content.startsWith('$ticket pomoc')) {
        const embed = new EmbedBuilder()
            .setTitle("pomoc")
            .setDescription("Kliknij przycisk poniżej, aby uzyskać pomoc.")
            .setColor(0x00AE86);

        const button = new ButtonBuilder()
            .setCustomId('create_ticket_pomoc')
            .setLabel('Utwórz Ticket Pomoc')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);
        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket_zglos' || interaction.customId === 'create_ticket_pomoc') {
        try {
            const guild = interaction.guild;
            const username = interaction.user.username;
            const channelName = `ticket-${username}`;

            // Użytkownik tworzący kanał otrzymuje uprawnienia, w tym do pingowania @everyone
            const userAllowedPermissions = [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.MentionEveryone
            ];

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_OPEN,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: userAllowedPermissions
                    },
                    {
                        id: ADMIN_ROLE_ID,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    }
                ]
            });

            // Wzmianka użytkownika w nowo utworzonym kanale
            await ticketChannel.send({ 
                content: `<@${interaction.user.id}>`, 
                allowedMentions: { users: [interaction.user.id] } 
            });

            // Ustalamy tytuł i opis embed'a w zależności od wywołanej komendy
            let embedTitle, descriptionText;
            if (interaction.customId === 'create_ticket_zglos') {
                embedTitle = "zglos";
                descriptionText = "Napisz nick użytkownika oraz powód zgłoszenia i poczekaj na odpowiedź admina.";
            } else {
                embedTitle = "pomoc";
                descriptionText = "Opisz dokładnie swój problem i oznacz administratorów.";
            }

            const ticketEmbed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setDescription(descriptionText)
                .setColor(0xFF0000);

            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij Ticket')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(closeButton);
            await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });

            await interaction.reply({ content: `Ticket utworzony: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error("Błąd przy tworzeniu kanału:", error);
            await interaction.reply({ content: "Wystąpił błąd przy tworzeniu ticketa.", flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.customId === 'close_ticket') {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: "Tylko administrator może zamknąć ten ticket.", flags: MessageFlags.Ephemeral });
        }
        
        const ticketChannel = interaction.channel;
        await ticketChannel.setParent(TICKET_CATEGORY_CLOSED, { lockPermissions: false });
        await ticketChannel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
        await interaction.reply({ content: "Ticket został zamknięty i przeniesiony do archiwum." });
    }
});

client.login(process.env.TOKEN);
