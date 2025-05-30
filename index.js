// index.js
require('dotenv').config();
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, Events 
} = require('discord.js');
require('./database'); // łączy z MongoDB
const ReactionRole = require('./ReactionRole'); // model Mongoose

// ID kanałów i kategorii (zmień na swoje)
const REGULAMIN_CHANNEL_ID = '1348705958939066396';
const WELCOME_CHANNEL_ID   = '1348705958939066393';
const TICKET_CATEGORY_ID   = '1350857928583807039';
const CLOSED_CATEGORY_ID   = '1350857964675661885';

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

// Po zalogowaniu
client.once(Events.ClientReady, () => {
  console.log(`Bot zalogowany jako ${client.user.tag}`);
});

// Komenda $rr – konfiguracja reaction roles
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

    // 3) Opis embedu
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

    // 8) Dodajemy reakcje i zapisujemy w DB
    for (const p of pairs) {
      await sent.react(p.emoji).catch(console.error);
      await ReactionRole.create({
        guildId: message.guild.id,
        channelId: chan.id,
        messageId: sent.id,
        exclusive,
        emoji: p.emoji,
        roleId: p.roleId
      }).catch(err => console.error('Błąd DB:', err));
    }

    await message.channel.send('Reaction role utworzone!');
  } catch {
    message.channel.send('Coś poszło nie tak lub czas minął.');
  }
});

// Obsługa reaction roles – dodawanie roli
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  const msg = reaction.message;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.toString();

  const entry = await ReactionRole.findOne({ messageId: msg.id, guildId: msg.guild.id, emoji: emojiKey });
  if (!entry) return;

  const member = await msg.guild.members.fetch(user.id);
  if (entry.exclusive) {
    // usuń inne reakcje i role
    for (const other of await ReactionRole.find({ messageId: msg.id, guildId: msg.guild.id })) {
      if (other.roleId !== entry.roleId) {
        await member.roles.remove(other.roleId).catch(() => {});
        // opcjonalnie usuń reakcję użytkownika na innych emoji:
        const r = msg.reactions.cache.get(other.emoji);
        if (r) await r.users.remove(user.id).catch(() => {});
      }
    }
  }
  await member.roles.add(entry.roleId).catch(console.error);
});

// Obsługa reaction roles – usuwanie roli
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  const msg = reaction.message;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.toString();

  const entry = await ReactionRole.findOne({ messageId: msg.id, guildId: msg.guild.id, emoji: emojiKey });
  if (!entry) return;

  const member = await msg.guild.members.fetch(user.id);
  await member.roles.remove(entry.roleId).catch(console.error);
});

// Powitanie nowych członków
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!ch?.isTextBased()) return;

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

// System ticketów – przyciski i kanały
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild } = interaction;

  // Tworzenie ticketu
  if (customId === 'report_user' || customId === 'report_problem') {
    const clean = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = `ticket-${clean}-${user.discriminator}`;
    const ticket = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    });
    await interaction.reply({ content: `Ticket utworzony: <#${ticket.id}>`, ephemeral: true });

    const embed = new EmbedBuilder()
      .setDescription('Opisz swój problem lub zachowanie użytkownika tutaj. Po zakończeniu kliknij **Zamknij Ticket**.')
      .setColor('Blue');
    withFooter(embed);

    const closeBtn = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Zamknij Ticket')
      .setStyle(ButtonStyle.Danger);

    await ticket.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(closeBtn)]
    });
  }

  // Zamknięcie ticketu
  if (customId === 'close_ticket') {
    const chan = interaction.channel;
    if (!chan || chan.parentId !== TICKET_CATEGORY_ID) return;
    if (CLOSED_CATEGORY_ID) {
      await chan.setParent(CLOSED_CATEGORY_ID);
      await chan.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });
      await interaction.reply({ content: 'Ticket zamknięty i przeniesiony.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Ticket zostanie usunięty.', ephemeral: true });
      setTimeout(() => chan.delete(), 1000);
    }
  }
});

client.login(process.env.TOKEN);
