// Kluczowe moduły
const fs = require('fs');
const { Client, GatewayIntentBits, Partials, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');

// Token i konfiguracje
const WELCOME_CHANNEL_ID = '1348705958939066393'; // ID kanału powitalnego
const RULES_CHANNEL_ID = '1348705958939066396'; // (opcjonalnie) ID kanału z regulaminem

// Utworzenie klienta Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

// Plik JSON do przechowywania konfiguracji reaction roles
const reactionRolesFile = './reactionRoles.json';
let reactionRoles = [];

// Wczytanie danych reaction roles z pliku JSON
if (fs.existsSync(reactionRolesFile)) {
    try {
        const data = fs.readFileSync(reactionRolesFile, 'utf8');
        reactionRoles = JSON.parse(data);
        if (!Array.isArray(reactionRoles)) reactionRoles = [];
    } catch (err) {
        console.error('Błąd podczas czytania pliku reactionRoles.json:', err);
        reactionRoles = [];
    }
} else {
    reactionRoles = [];
    fs.writeFileSync(reactionRolesFile, JSON.stringify(reactionRoles, null, 2));
}

// Zapis danych reaction roles do pliku
function saveReactionRoles() {
    fs.writeFileSync(reactionRolesFile, JSON.stringify(reactionRoles, null, 2));
}

// Event: bot wstaje online
client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
});

// Event: nowy członek dołącza do serwera -> wysyłamy wiadomość powitalną
client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    // Tworzymy embed powitalny
    const welcomeEmbed = new EmbedBuilder()
        .setTitle(`Witaj, ${member.user.username}!`)
        .setDescription('Cieszymy się, że dołączyłeś! Kliknij przycisk poniżej, aby zapoznać się z regulaminem.')
        .setColor('#0099ff');
    const rulesButton = new ButtonBuilder()
        .setCustomId('rules')
        .setLabel('Regulamin')
        .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(rulesButton);
    channel.send({ content: `${member}`, embeds: [welcomeEmbed], components: [row] });
});

// Event: reakcja została dodana do wiadomości
client.on('messageReactionAdd', async (reaction, user) => {
    // Pominięcie reakcji bota
    if (user.bot) return;
    // Jeśli partial (niepełny) to fetchujemy pełną treść
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (err) {
            console.error('Nie udało się pobrać reakcji:', err);
            return;
        }
    }
    const message = reaction.message;
    // Szukamy w konfiguracji reaction roles
    const config = reactionRoles.find(rr => rr.messageId === message.id);
    if (!config) return;
    // Sprawdzamy, czy dany emoji znajduje się w konfiguracji
    let roleId = null;
    if (reaction.emoji.id) {
        // Emoji niestandardowe
        const entry = config.roles.find(r => r.emojiId === reaction.emoji.id);
        if (entry) roleId = entry.roleId;
    } else {
        // Emoji Unicode
        const entry = config.roles.find(r => r.emoji === reaction.emoji.name);
        if (entry) roleId = entry.roleId;
    }
    if (!roleId) return; // brak przypisania dla tej reakcji
    // Pobieramy obiekt członka
    const guild = message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    if (!member) return;
    // Dodajemy rolę
    member.roles.add(roleId).catch(console.error);
    // Jeżeli tryb singleChoice, usuwamy inne role i reakcje
    if (config.singleChoice) {
        for (const mapping of config.roles) {
            // Pomijamy aktualny emoji
            if (reaction.emoji.id ? (mapping.emojiId === reaction.emoji.id) : (mapping.emoji === reaction.emoji.name)) continue;
            const otherRole = mapping.roleId;
            // Jeśli członek ma tę rolę, usuwamy ją
            if (member.roles.cache.has(otherRole)) {
                member.roles.remove(otherRole).catch(console.error);
            }
            // Usuwamy reakcję użytkownika (jeśli istnieje) dla innych emoji na tej wiadomości
            let reactionToRemove = null;
            if (mapping.emojiId) {
                reactionToRemove = message.reactions.cache.get(mapping.emojiId);
            } else {
                reactionToRemove = message.reactions.cache.find(r => r.emoji.name === mapping.emoji);
            }
            if (reactionToRemove) {
                reactionToRemove.users.remove(user.id).catch(() => {});
            }
        }
    }
});

// Event: reakcja została usunięta z wiadomości
client.on('messageReactionRemove', async (reaction, user) => {
    // Pominięcie reakcji bota
    if (user.bot) return;
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (err) {
            console.error('Nie udało się pobrać reakcji:', err);
            return;
        }
    }
    const message = reaction.message;
    // Szukamy konfigurację reaction roles
    const config = reactionRoles.find(rr => rr.messageId === message.id);
    if (!config) return;
    // Sprawdzamy emoji
    let roleId = null;
    if (reaction.emoji.id) {
        const entry = config.roles.find(r => r.emojiId === reaction.emoji.id);
        if (entry) roleId = entry.roleId;
    } else {
        const entry = config.roles.find(r => r.emoji === reaction.emoji.name);
        if (entry) roleId = entry.roleId;
    }
    if (!roleId) return;
    // Usuwamy rolę
    const guild = message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    if (!member) return;
    member.roles.remove(roleId).catch(console.error);
});

// Event: wiadomość wysłana (komendy $ticket, $rr itp.)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const content = message.content.trim();
    // Reakcje: komenda $rr ...
    if (content.startsWith('$rr')) {
        const args = content.slice(3).trim().split(/ +/);
        const sub = args.shift();
        if (!sub) {
            return message.reply('Użycie: `$rr create|add|remove|list|singleChoice ...`');
        }
        // Podkomendy systemu reaction roles
        if (sub === 'create') {
            // Możliwość ustawienia singleChoice jako drugi argument (true/false)
            const single = args[0] === 'true';
            const embed = new EmbedBuilder()
                .setTitle('Reaguj aby otrzymać rolę')
                .setDescription('Zareaguj poniżej emoji, aby otrzymać przypisaną rolę.')
                .setColor('#00AAFF');
            if (single) {
                embed.setFooter({ text: 'Tryb: wybór pojedynczy (singleChoice)' });
            }
            const sent = await message.channel.send({ embeds: [embed] });
            // Dodajemy konfigurację
            reactionRoles.push({
                messageId: sent.id,
                channelId: sent.channel.id,
                guildId: message.guild.id,
                singleChoice: single,
                roles: []
            });
            saveReactionRoles();
            message.reply(`Utworzono wiadomość reaction roles (ID: ${sent.id}).`);
        } else if (sub === 'add') {
            // Format: $rr add [#kanal] <messageId> <emoji> <@role>
            let channel = message.channel;
            let messageIdArg;
            let emojiArg;
            let roleArg;
            // Jeśli drugi argument to kanał
            if (args[0] && args[0].startsWith('<#')) {
                const chanId = args[0].slice(2, -1);
                const found = message.guild.channels.cache.get(chanId);
                if (!found) return message.reply('Nie znaleziono takiego kanału.');
                channel = found;
                args.shift();
            }
            messageIdArg = args[0];
            emojiArg = args[1];
            roleArg = args[2];
            if (!messageIdArg || !emojiArg || !roleArg) {
                return message.reply('Użycie: `$rr add [#kanał] <messageId> <emoji> <@role>`');
            }
            // Znajdź konfigurację po ID wiadomości
            const config = reactionRoles.find(rr => rr.messageId === messageIdArg);
            if (!config) return message.reply('Ta wiadomość nie jest skonfigurowana w systemie reaction roles.');
            // Parsowanie roli
            let roleId;
            const roleMatch = roleArg.match(/(\d+)/);
            if (roleMatch) roleId = roleMatch[1];
            const role = message.guild.roles.cache.get(roleId);
            if (!role) return message.reply('Nie znaleziono takiej roli.');
            // Parsowanie emoji
            let emojiId = null;
            let emojiName = null;
            let isCustom = false;
            const customMatch = emojiArg.match(/<a?:([a-zA-Z0-9_]+):(\d+)>/);
            if (customMatch) {
                isCustom = true;
                emojiName = customMatch[1];
                emojiId = customMatch[2];
            } else {
                emojiName = emojiArg; // unicode emoji
            }
            // Sprawdzamy, czy już taka rola/emoji nie istnieje
            const exists = config.roles.find(r => {
                if (isCustom && r.emojiId) return r.emojiId === emojiId;
                if (!isCustom && r.emoji === emojiName) return r.emoji === emojiName;
                return false;
            });
            if (exists) {
                return message.reply('Ta reakcja jest już dodana do konfiguracji.');
            }
            // Dodajemy do konfiguracji
            if (isCustom) {
                config.roles.push({ emojiId: emojiId, emojiName: emojiName, roleId: roleId });
            } else {
                config.roles.push({ emoji: emojiName, roleId: roleId });
            }
            saveReactionRoles();
            // Dodajemy reakcję na wiadomości
            try {
                const targetMsg = await channel.messages.fetch(messageIdArg);
                if (isCustom) {
                    const emojiObj = message.guild.emojis.cache.get(emojiId);
                    if (emojiObj) {
                        await targetMsg.react(emojiObj);
                    } else {
                        await targetMsg.react(emojiArg);
                    }
                } else {
                    await targetMsg.react(emojiName);
                }
                // Aktualizujemy embed wiadomości z listą ról
                const newEmbed = EmbedBuilder.from(targetMsg.embeds[0] || new EmbedBuilder())
                    .setColor('#00AAFF')
                    .setTitle('Role za reakcję');
                if (config.singleChoice) {
                    newEmbed.setFooter({ text: 'Tryb: wybór pojedynczy (singleChoice)' });
                } else {
                    newEmbed.setFooter({ text: 'Tryb: wiele wyborów dozwolonych' });
                }
                // Dodajemy pola dla każdej pary emoji->rola
                const fields = [];
                for (const mapping of config.roles) {
                    if (mapping.emojiId) {
                        fields.push({
                            name: `<:${mapping.emojiName}:${mapping.emojiId}>`,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    } else {
                        fields.push({
                            name: mapping.emoji,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    }
                }
                newEmbed.setFields(fields);
                await targetMsg.edit({ embeds: [newEmbed] });
                message.reply('Dodano reakcję do wiadomości i zaktualizowano embed.');
            } catch (err) {
                console.error('Błąd podczas dodawania reakcji lub edycji wiadomości:', err);
                message.reply('Wystąpił błąd podczas dodawania reakcji.');
            }
        } else if (sub === 'remove') {
            // Format: $rr remove [#kanal] <messageId> <emoji lub @role>
            let channel = message.channel;
            if (args[0] && args[0].startsWith('<#')) {
                const chanId = args[0].slice(2, -1);
                const found = message.guild.channels.cache.get(chanId);
                if (!found) return message.reply('Nie znaleziono takiego kanału.');
                channel = found;
                args.shift();
            }
            const messageIdArg = args[0];
            const keyArg = args[1];
            if (!messageIdArg || !keyArg) {
                return message.reply('Użycie: `$rr remove [#kanał] <messageId> <emoji lub @role>`');
            }
            const config = reactionRoles.find(rr => rr.messageId === messageIdArg);
            if (!config) return message.reply('Ta wiadomość nie jest skonfigurowana w systemie reaction roles.');
            let removed = false;
            // Czy argument to rola?
            const roleMatch = keyArg.match(/(\d+)/);
            if (roleMatch) {
                const roleId = roleMatch[1];
                const index = config.roles.findIndex(r => r.roleId === roleId);
                if (index !== -1) {
                    // Ustalamy emoji do usunięcia (jeśli istnieje reakcja)
                    const mapping = config.roles[index];
                    // usuwamy mapowanie z konfiguracji
                    config.roles.splice(index, 1);
                    removed = true;
                    // Usuwamy reakcję z wiadomości
                    try {
                        const targetMsg = await channel.messages.fetch(messageIdArg);
                        let reactionToRemove = null;
                        if (mapping.emojiId) {
                            reactionToRemove = targetMsg.reactions.cache.get(mapping.emojiId);
                        } else {
                            reactionToRemove = targetMsg.reactions.cache.find(r => r.emoji.name === mapping.emoji);
                        }
                        if (reactionToRemove) {
                            await reactionToRemove.remove();
                        }
                    } catch (err) {
                        console.error('Błąd podczas usuwania reakcji:', err);
                    }
                }
            } else {
                // Parsujemy emoji
                const customMatch = keyArg.match(/<a?:([a-zA-Z0-9_]+):(\d+)>/);
                if (customMatch) {
                    const emojiId = customMatch[2];
                    const index = config.roles.findIndex(r => r.emojiId === emojiId);
                    if (index !== -1) {
                        const mapping = config.roles[index];
                        config.roles.splice(index, 1);
                        removed = true;
                        try {
                            const targetMsg = await channel.messages.fetch(messageIdArg);
                            const reactionToRemove = targetMsg.reactions.cache.get(emojiId);
                            if (reactionToRemove) {
                                await reactionToRemove.remove();
                            }
                        } catch (err) {
                            console.error('Błąd podczas usuwania reakcji:', err);
                        }
                    }
                } else {
                    // Unicode emoji
                    const emojiChar = keyArg;
                    const index = config.roles.findIndex(r => r.emoji === emojiChar);
                    if (index !== -1) {
                        const mapping = config.roles[index];
                        config.roles.splice(index, 1);
                        removed = true;
                        try {
                            const targetMsg = await channel.messages.fetch(messageIdArg);
                            const reactionToRemove = targetMsg.reactions.cache.find(r => r.emoji.name === emojiChar);
                            if (reactionToRemove) {
                                await reactionToRemove.remove();
                            }
                        } catch (err) {
                            console.error('Błąd podczas usuwania reakcji:', err);
                        }
                    }
                }
            }
            if (!removed) {
                return message.reply('Nie znaleziono takiego mapowania emoji→rola.');
            }
            saveReactionRoles();
            // Aktualizacja embed po usunięciu
            try {
                const targetMsg = await channel.messages.fetch(messageIdArg);
                const newEmbed = EmbedBuilder.from(targetMsg.embeds[0] || new EmbedBuilder())
                    .setColor('#00AAFF')
                    .setTitle('Role za reakcję');
                const fields = [];
                for (const mapping of config.roles) {
                    if (mapping.emojiId) {
                        fields.push({
                            name: `<:${mapping.emojiName}:${mapping.emojiId}>`,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    } else {
                        fields.push({
                            name: mapping.emoji,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    }
                }
                newEmbed.setFields(fields);
                if (config.singleChoice) {
                    newEmbed.setFooter({ text: 'Tryb: wybór pojedynczy (singleChoice)' });
                } else {
                    newEmbed.setFooter({ text: 'Tryb: wiele wyborów dozwolonych' });
                }
                await targetMsg.edit({ embeds: [newEmbed] });
            } catch (err) {
                console.error('Błąd podczas aktualizacji embed po usunięciu:', err);
            }
            message.reply('Usunięto przypisanie i zaktualizowano wiadomość.');
        } else if (sub === 'singleChoice') {
            // $rr singleChoice <messageId> <true/false>
            const messageIdArg = args[0];
            const boolArg = args[1];
            if (!messageIdArg || (boolArg !== 'true' && boolArg !== 'false')) {
                return message.reply('Użycie: `$rr singleChoice <messageId> <true/false>`');
            }
            const config = reactionRoles.find(rr => rr.messageId === messageIdArg);
            if (!config) return message.reply('Nie znaleziono konfiguracji dla podanego ID wiadomości.');
            config.singleChoice = (boolArg === 'true');
            saveReactionRoles();
            message.reply(`Ustawiono singleChoice=${config.singleChoice} dla wiadomości ${messageIdArg}.`);
            // (Opcjonalnie) aktualizacja embed w wiadomości, aby oznaczyć zmianę trybu
            try {
                const targetMsg = await message.channel.messages.fetch(messageIdArg);
                const newEmbed = EmbedBuilder.from(targetMsg.embeds[0] || new EmbedBuilder())
                    .setColor('#00AAFF')
                    .setTitle('Role za reakcję');
                if (config.singleChoice) {
                    newEmbed.setFooter({ text: 'Tryb: wybór pojedynczy (singleChoice)' });
                } else {
                    newEmbed.setFooter({ text: 'Tryb: wiele wyborów dozwolonych' });
                }
                // Role listing remains the same
                const fields = [];
                for (const mapping of config.roles) {
                    if (mapping.emojiId) {
                        fields.push({
                            name: `<:${mapping.emojiName}:${mapping.emojiId}>`,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    } else {
                        fields.push({
                            name: mapping.emoji,
                            value: `<@&${mapping.roleId}>`,
                            inline: true
                        });
                    }
                }
                newEmbed.setFields(fields);
                await targetMsg.edit({ embeds: [newEmbed] });
            } catch (err) {
                console.error('Błąd podczas aktualizacji wiadomości singleChoice:', err);
            }
        } else if (sub === 'list') {
            // Wyświetlenie listy konfiguracji reakcji
            const messageIdArg = args[0];
            if (!messageIdArg) {
                return message.reply('Użycie: `$rr list <messageId>`');
            }
            const config = reactionRoles.find(rr => rr.messageId === messageIdArg);
            if (!config) return message.reply('Nie znaleziono konfiguracji dla podanego ID wiadomości.');
            if (config.roles.length === 0) {
                return message.reply('Brak przypisanych ról dla tej wiadomości.');
            }
            let text = `Mapowania emoji→rola dla wiadomości ${messageIdArg}:\n`;
            for (const mapping of config.roles) {
                if (mapping.emojiId) {
                    text += `<:${mapping.emojiName}:${mapping.emojiId}> → <@&${mapping.roleId}>\n`;
                } else {
                    text += `${mapping.emoji} → <@&${mapping.roleId}>\n`;
                }
            }
            message.reply(text);
        } else {
            message.reply('Nieznana podkomenda `$rr`. Dostępne: create, add, remove, singleChoice, list.');
        }
    }
    // Komenda $ticket
    else if (content.startsWith('$ticket')) {
        const args = content.slice(7).trim().split(/ +/);
        const action = args[0];
        if (action === 'zglos' || action === 'pomoc') {
            const type = action;
            // Tworzymy unikalną nazwę kanału
            const name = `${type}-${message.author.username}-${message.author.id}`;
            // Sprawdzamy, czy taki kanał już istnieje
            const existing = message.guild.channels.cache.find(ch => ch.name === name);
            if (existing) {
                return message.reply(`Masz już otwarty kanał ${type}.`);
            }
            // Tworzymy nowy kanał tekstowy
            try {
                const ticketChannel = await message.guild.channels.create({
                    name: name,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: message.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks] }
                    ]
                });
                // Wysyłamy wiadomość powitalną w kanale ticketowym
                const ticketEmbed = new EmbedBuilder()
                    .setTitle('Ticket - ' + (type === 'zglos' ? 'Zgłoszenie' : 'Pomoc'))
                    .setDescription(`Witaj! Opisz swój problem lub pytanie. Gdy chcesz zamknąć ticket, kliknij przycisk poniżej.`)
                    .setColor('#00FF00');
                const closeButton = new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Zamknij Ticket')
                    .setStyle(ButtonStyle.Danger);
                const row = new ActionRowBuilder().addComponents(closeButton);
                await ticketChannel.send({ content: `<@${message.author.id}>`, embeds: [ticketEmbed], components: [row] });
                message.reply(`Utworzono nowy kanał ticketowy: ${ticketChannel}`);
            } catch (err) {
                console.error('Błąd podczas tworzenia kanału ticketowego:', err);
                message.reply('Wystąpił błąd podczas tworzenia kanału zgłoszenia.');
            }
        } else {
            message.reply('Użycie: `$ticket zglos` lub `$ticket pomoc`');
        }
    }
});

// Event: kliknięto przycisk
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'rules') {
        // Odpowiadamy ephemeraśnie z regulaminem lub linkiem do niego
        let text = 'Zapoznaj się z regulaminem serwera!';
        if (RULES_CHANNEL_ID) {
            text = `Zapoznaj się z regulaminem na kanale <#${RULES_CHANNEL_ID}>.`;
        }
        await interaction.reply({ content: text, ephemeral: true });
    }
    if (interaction.customId === 'close_ticket') {
        const channel = interaction.channel;
        if (channel && (channel.name.startsWith('zglos-') || channel.name.startsWith('pomoc-'))) {
            await interaction.reply({ content: 'Zamykam ten ticket...', ephemeral: true });
            setTimeout(() => {
                channel.delete().catch(console.error);
            }, 1000);
        } else {
            await interaction.reply({ content: 'Ten przycisk nie może zostać użyty tutaj.', ephemeral: true });
        }
    }
});


client.login(process.env.TOKEN);
