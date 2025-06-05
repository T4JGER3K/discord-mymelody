require('dotenv').config();
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, Events,
  ActivityType
} = require('discord.js');
require('./database'); // łączy z MongoDB
const ReactionRole = require('./ReactionRole'); // model Mongoose

// -------------------- CACHE SETUP --------------------
// Reakcje przechowywane w pamięci dla szybszego dostępu
const reactionRoleCache = new Map();

async function loadReactionRoles() {
  try {
    // Synchronizuj indeksy w DB
    await ReactionRole.syncIndexes();
    // Pobierz wszystkie wpisy z kolekcji
    const all = await ReactionRole.find().lean();
    for (const entry of all) {
      const key = `${entry.guildId}:${entry.messageId}`;
      if (!reactionRoleCache.has(key)) reactionRoleCache.set(key, []);
      reactionRoleCache.get(key).push(entry);
    }
    console.log(`Załadowano ${all.length} reakcji z bazy`);
  } catch (err) {
    console.error('Błąd ładowania reaction roles:', err);
  }
}

function getCacheEntries(guildId, messageId) {
  return reactionRoleCache.get(`${guildId}:${messageId}`) || [];
}

// -------------------- CONFIG --------------------
const REGULAMIN_CHANNEL_ID = '1348705958939066396';
const WELCOME_CHANNEL_ID   = '1348705958939066393';

function withFooter(embed) {
  return embed.setFooter({ text: '© tajgerek' });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// -------------------- READY --------------------
client.once(Events.ClientReady, async () => {
  console.log(`Bot zalogowany jako ${client.user.tag}`);
  // Ustawienie statusu Streamingu
  client.user.setPresence({
    activities: [{
      name: 'cinamoinka',
      type: ActivityType.Streaming,
      url: 'https://twitch.tv/cinamoinka'
    }],
    status: 'online'
  });

  // Załaduj cache reaction roles
  await loadReactionRoles();
});

// -------------------- KOMENDA $rr --------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content !== '$rr' || !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  const filter = m => m.author.id === message.author.id;
  const TIMEOUT = 180000;

  try {
    // 1) Wybór kanału
    await message.channel.send('Na jakim kanale ma być wiadomość? (podaj #nazwakanału)');
    const chanMsg = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] });
    const chan = chanMsg.first().mentions.channels.first();
    if (!chan) return message.channel.send('❌ Niepoprawny kanał. Przerwano.');

    // 2) Tytuł embedu
    await message.channel.send('Podaj tytuł embeda:');
    const title = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] })).first().content;

    // 3) Opis embeda
    await message.channel.send('Podaj treść embeda:');
    const description = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] })).first().content;

    // 4) Kolor embedu
    await message.channel.send('Podaj kolor embeda:');
    const color = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] })).first().content;

    // 5) Jednokrotny wybór?
    await message.channel.send('Czy role mają być jednokrotnego wyboru? (tak/nie)');
    const exclusiveResp = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] })).first().content.toLowerCase();
    const exclusive = exclusiveResp === 'tak';

    // 6) Parowanie emoji ↔️ rola
    const pairs = [];
    await message.channel.send("Podaj reakcję i rolę (emoji @rola). Wpisz 'gotowe' by zakończyć.");
    while (true) {
      const resp = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] });
      const text = resp.first().content.trim();
      if (text.toLowerCase() === 'gotowe') break;

      const [em, ...rest] = text.split(/\s+/);
      const role = resp.first().mentions.roles.first();
      if (!em || !role) {
        await message.channel.send('Niepoprawny format, użyj: <emoji> @rola');
        continue;
      }
      pairs.push({ emoji: em, roleId: role.id });
      await message.channel.send(`Dodano: ${em} -> ${role.name}`);
    }

    // 7) Wysyłamy embed
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color);
    withFooter(embed);
    const sent = await chan.send({ embeds: [embed] });

    // 8) Dodajemy reakcje, zapisujemy w DB i cache
    for (const p of pairs) {
      await sent.react(p.emoji).catch(console.error);
      const doc = await ReactionRole.create({
        guildId: message.guild.id,
        channelId: chan.id,
        messageId: sent.id,
        exclusive,
        emoji: p.emoji,
        roleId: p.roleId
      });
      // Aktualizuj cache
      const key = `${doc.guildId}:${doc.messageId}`;
      if (!reactionRoleCache.has(key)) reactionRoleCache.set(key, []);
      reactionRoleCache.get(key).push(doc);
    }

    await message.channel.send('Reaction role utworzone!');
  } catch (e) {
    console.error(e);
    message.channel.send('Coś poszło nie tak lub czas minął.');
  }
});

// -------------------- HANDLERY REAKCJI --------------------
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  if (reaction.message.partial) try { await reaction.message.fetch(); } catch { return; }

  const msg = reaction.message;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.toString();

  const entries = getCacheEntries(msg.guild.id, msg.id);
  const entry = entries.find(e => e.emoji === emojiKey);
  if (!entry) return;

  const member = await msg.guild.members.fetch(user.id);
  if (entry.exclusive) {
    for (const other of entries) {
      if (other.roleId !== entry.roleId) {
        await member.roles.remove(other.roleId).catch(() => {});
        const r = msg.reactions.cache.get(other.emoji);
        if (r) await r.users.remove(user.id).catch(() => {});
      }
    }
  }
  await member.roles.add(entry.roleId).catch(console.error);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  if (reaction.message.partial) try { await reaction.message.fetch(); } catch { return; }

  const msg = reaction.message;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.toString();

  const entries = getCacheEntries(msg.guild.id, msg.id);
  const entry = entries.find(e => e.emoji === emojiKey);
  if (!entry) return;

  const member = await msg.guild.members.fetch(user.id);
  await member.roles.remove(entry.roleId).catch(console.error);
});

// -------------------- POWITANIE --------------------
const recentlyWelcomed = new Set();
client.on(Events.GuildMemberAdd, async (member) => {
  if (recentlyWelcomed.has(member.id)) return;
  recentlyWelcomed.add(member.id);
  setTimeout(() => recentlyWelcomed.delete(member.id), 5000);

  try {
    const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!ch.isTextBased()) return;

    const welcomeEmbed = new EmbedBuilder()
      .setTitle('🎉 Witamy na serwerze! 🎉')
      .setDescription(
        `Witaj <@${member.id}>!\n\n` +
        'Cieszymy się, że dołączyłeś do naszej społeczności. ' +
        'Mamy nadzieję, że znajdziesz tu przyjazne środowisko oraz wiele ciekawych rozmów i aktywności. ' +
        'Zapoznaj się z regulaminem i zasadami serwera, aby w pełni korzystać z dostępnych możliwości. ' +
        'Jeszcze raz – witamy serdecznie!'
      )
      .addFields(
        { name: 'Nazwa użytkownika',    value: member.user.username, inline: true },
        { name: 'Data utworzenia konta', value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor('Aqua')
      .setTimestamp();
    withFooter(welcomeEmbed);

    const regBtn = new ButtonBuilder()
      .setLabel('📜 Regulamin')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${member.guild.id}/${REGULAMIN_CHANNEL_ID}`);

    await ch.send({ embeds: [welcomeEmbed], components: [new ActionRowBuilder().addComponents(regBtn)] });
  } catch (err) {
    console.error('Błąd powitania:', err);
  }
});

client.login(process.env.TOKEN);
