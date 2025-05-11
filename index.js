const { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const prefix = '$';
const dynamicReactionRoleMap = new Map(); // mapuje ID wiadomości → obiekt { emojiKey: rolaID, ... }

client.once('ready', () => {
    console.log(`Bot zalogowany jako ${client.user.tag}`);
});

// Obsługa komend tekstowych
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Komenda $rr – tworzy wiadomość z reakcjami przydzielającymi role
    if (command === 'rr') {
        // Tylko administrator może użyć tej komendy
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("Nie masz uprawnień do użycia tej komendy.");
        }
        // Wyznaczamy kanał (pierwszy mention lub bieżący)
        const targetChannel = message.mentions.channels.first() || message.channel;
        // Wyciągamy treść wiadomości z cudzysłowów
        const textMatch = message.content.match(/"([^"]+)"/);
        if (!textMatch) {
            return message.reply('Poprawne użycie: $rr #kanał "Treść wiadomości" [emoji rola] [emoji rola] ...');
        }
        const text = textMatch[1];
        // Pozostałe argumenty po treści (powinny być w parach emoji + rola)
        const parts = message.content
            .slice(message.content.indexOf(textMatch[0]) + textMatch[0].length)
            .trim()
            .split(/\s+/);
        if (parts.length % 2 !== 0 || parts.length === 0) {
            return message.reply('Nieprawidłowa liczba argumentów. Pamiętaj o parach `emoji rola`.');
        }
        // Wysyłamy wiadomość z tekstem
        const sentMessage = await targetChannel.send(text);
        // Przetwarzamy pary (emoji, rola)
        for (let i = 0; i < parts.length; i += 2) {
            const emojiRaw = parts[i];
            const roleMention = parts[i + 1];
            // Wyciągamy ID roli z mentionu (np. <@&123456>)
            const roleIdMatch = roleMention.match(/\d+/);
            if (!roleIdMatch) {
                message.reply(`Niepoprawny format roli: ${roleMention}`);
                continue;
            }
            const role = message.guild.roles.cache.get(roleIdMatch[0]);
            if (!role) {
                message.reply(`Nie znaleziono roli: ${roleMention}`);
                continue;
            }
            // Dodajemy reakcję do wiadomości
            try {
                await sentMessage.react(emojiRaw);
            } catch (err) {
                console.error('Nie udało się dodać reakcji:', err);
            }
            // Ustalamy klucz emoji (ID dla emoji niestandardowych lub nazwa/unicode)
            let emojiKey;
            const customIdMatch = emojiRaw.match(/^<a?:\w+:(\d+)>$/);
            if (customIdMatch) {
                emojiKey = customIdMatch[1]; // ID emoji niestandardowego
            } else {
                emojiKey = emojiRaw; // zwykły unicode lub uproszczony
            }
            // Zapisujemy mapowanie w dynamicReactionRoleMap
            const mapEntry = dynamicReactionRoleMap.get(sentMessage.id) || {};
            mapEntry[emojiKey] = role.id;
            dynamicReactionRoleMap.set(sentMessage.id, mapEntry);
        }
        return;
    }

    // Komenda $ticket – otwiera nowy kanał (ticket) dla użytkownika
    if (command === 'ticket') {
        const guild = message.guild;
        const ticketName = `ticket-${message.author.id}`;
        // Sprawdzamy, czy użytkownik już ma otwarty ticket
        if (guild.channels.cache.some(c => c.name === ticketName)) {
            return message.reply("Masz już otwarty ticket.");
        }
        // Tworzymy kanał tekstowy z ograniczonym dostępem
        const channel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: message.author.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                // Opcjonalnie: można dodać także ID roli administracyjnej/moderatora
            ],
        });
        channel.send(`Witaj ${message.author}, jak możemy Ci pomóc?`);
        return message.reply(`Twój ticket został utworzony: ${channel}`);
    }
});

// Event gdy użytkownik dołącza do serwera – wysyłamy powitanie
client.on('guildMemberAdd', member => {
    // Szukamy kanału powitań (np. nazwanego "powitania" lub "welcome")
    const welcomeChannel = member.guild.channels.cache.find(ch => 
        ch.name.toLowerCase().includes('powitania') ||
        ch.name.toLowerCase().includes('welcome')
    );
    if (welcomeChannel) {
        welcomeChannel.send(`Witaj ${member}, na naszym serwerze!`);
    }
});

// Obsługa dodania reakcji – przydzielanie roli
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return; // ignorujemy reakcje botów
    // Jeśli reaction jest partial, pobieramy pełne dane
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Błąd przy pobieraniu reakcji:', error);
            return;
        }
    }
    // Sprawdzamy, czy wiadomość była wysłana przez tego bota
    if (reaction.message.author?.id !== client.user.id) return;
    // Sprawdzamy czy mamy mapowanie dla tej wiadomości
    const mapEntry = dynamicReactionRoleMap.get(reaction.message.id);
    if (!mapEntry) return;
    // Ustalamy klucz emoji, który zapisaliśmy
    const emojiKey = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
    const roleId = mapEntry[emojiKey];
    if (!roleId) return;
    try {
        const member = await reaction.message.guild.members.fetch(user.id);
        await member.roles.add(roleId);
    } catch (err) {
        console.error('Nie udało się dodać roli:', err);
    }
});

// Obsługa usunięcia reakcji – usuwanie roli (opcjonalnie)
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Błąd przy pobieraniu reakcji:', error);
            return;
        }
    }
    if (reaction.message.author?.id !== client.user.id) return;
    const mapEntry = dynamicReactionRoleMap.get(reaction.message.id);
    if (!mapEntry) return;
    const emojiKey = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
    const roleId = mapEntry[emojiKey];
    if (!roleId) return;
    try {
        const member = await reaction.message.guild.members.fetch(user.id);
        await member.roles.remove(roleId);
    } catch (err) {
        console.error('Nie udało się usunąć roli:', err);
    }
});

// Logowanie bota (wstaw swój token)
client.login(process.env.TOKEN);
