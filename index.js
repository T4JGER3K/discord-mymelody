require('dotenv').config();
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, PermissionsBitField, Events, ActivityType
} = require('discord.js');
require('./database'); // łączy z MongoDB
const ReactionRole = require('./ReactionRole'); // model Mongoose

// -------------------- CACHE SETUP --------------------
const reactionRoleCache = new Map();

async function loadReactionRoles() {
  try {
    await ReactionRole.syncIndexes();
    const all = await ReactionRole.find().lean();
    const toFetch = new Map();
    for (const entry of all) {
      const key = `${entry.guildId}:${entry.messageId}`;
      if (!reactionRoleCache.has(key)) reactionRoleCache.set(key, []);
      reactionRoleCache.get(key).push(entry);
      // Track messages to preload
      const channelKey = `${entry.guildId}:${entry.channelId}`;
      if (!toFetch.has(channelKey)) toFetch.set(channelKey, new Set());
      toFetch.get(channelKey).add(entry.messageId);
    }

    // Preload messages into cache to avoid partial fetch delays
    for (const [chKey, msgs] of toFetch.entries()) {
      const [guildId, channelId] = chKey.split(':');
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) continue;
      for (const msgId of msgs) {
        channel.messages.fetch(msgId).catch(() => {});
      }
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
  client.user.setPresence({
    activities: [{ name: 'cinamoinka', type: ActivityType.Streaming, url: 'https://twitch.tv/cinamoinka' }],
    status: 'online'
  });
  await loadReactionRoles();
});

// -------------------- KOMENDA $rr --------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content !== '$rr' || !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  const filter = m => m.author.id === message.author.id;
  const TIMEOUT = 180000;

  try {
    await message.channel.send('Na jakim kanale ma być wiadomość? (podaj #nazwakanału)');
    const chanMsg = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] });
    const chan = chanMsg.first().mentions.channels.first();
    if (!chan) return message.channel.send('❌ Niepoprawny kanał. Przerwano.');

    await message.channel.send('Podaj tytuł embeda:');
    const title = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Podaj treść embeda:');
    const description = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Podaj kolor embeda:');
    const color = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Czy role mają być jednokrotnego wyboru? (tak/nie)');
    const exclusive = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content.toLowerCase() === 'tak';

    const pairs = [];
    await message.channel.send("Podaj reakcję i rolę (emoji @rola). Wpisz 'gotowe' by zakończyć.");
    while (true) {
      const resp = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT });
      const text = resp.first().content.trim();
      if (text.toLowerCase() === 'gotowe') break;
      const [em] = text.split(/\s+/);
      const role = resp.first().mentions.roles.first();
      if (!em || !role) {
        await message.channel.send('Niepoprawny format, użyj: <emoji> @rola');
        continue;
      }
      pairs.push({ emoji: em, roleId: role.id });
      await message.channel.send(`Dodano: ${em} -> ${role.name}`);
    }

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
    withFooter(embed);
    const sent = await chan.send({ embeds: [embed] });

    for (const p of pairs) {
      await sent.react(p.emoji).catch(console.error);
      const doc = await ReactionRole.create({ guildId: message.guild.id, channelId: chan.id, messageId: sent.id, exclusive, emoji: p.emoji, roleId: p.roleId });
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

  let member = msg.guild.members.cache.get(user.id);
  if (!member) member = await msg.guild.members.fetch(user.id);

  if (entry.exclusive) {
    // Równoległe usunięcie wszystkich innych
    await Promise.all(entries.filter(o => o.roleId !== entry.roleId).map(async other => {
      await member.roles.remove(other.roleId).catch(() => {});
      const r = msg.reactions.cache.get(other.emoji);
      if (r) r.users.remove(user.id).catch(() => {});
    }));
  }

  member.roles.add(entry.roleId).catch(console.error);
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

  let member = msg.guild.members.cache.get(user.id);
  if (!member) member = await msg.guild.members.fetch(user.id);

  member.roles.remove(entry.roleId).catch(console.error);
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
