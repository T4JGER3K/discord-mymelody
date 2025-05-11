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
  Partials,
  MessageFlags
} = require('discord.js');

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

// PODMIEŃ NA SWOJE ID
const TICKET_CATEGORY_OPEN   = '1350857928583807039';
const TICKET_CATEGORY_CLOSED = '1350857964675661885';
const ADMIN_ROLE_ID          = '1350176648368230601';
const WELCOME_CHANNEL_ID     = '1348705958939066393';
const REGULAMIN_CHANNEL_ID   = '1348705958939066396';

// mapa: messageId → { emojiKey: { roleId, singleChoice:false } }
const dynamicReactionRoleMap = new Map();

// helper: dodaje stopkę © tajgerek
function withFooter(embed) {
  return embed.setFooter({ text: '© tajgerek' });
}

client.once('ready', () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
  client.user.setActivity("cinamoinka", {
    type: ActivityType.Streaming,
    url: "https://www.twitch.tv/cinamoinka"
  });
});

// POWITANIE NOWYCH UŻYTKOWNIKÓW
client.on('guildMemberAdd', async member => {
  try {
    const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!ch?.isTextBased()) return;

    const welcomeEmbed = withFooter(new EmbedBuilder()
      .setTitle('🎉 Witamy na serwerze! 🎉')
      .setDescription(
        `Witaj <@${member.id}>!\n\n` +
        `Cieszymy się, że dołączyłeś do naszej społeczności. ` +
        `Zapoznaj się z regulaminem, aby w pełni korzystać z serwera.`
      )
      .addFields(
        { name: 'Nazwa użytkownika',    value: member.user.username, inline: true },
        { name: 'Data utworzenia konta', value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor(0x00AE86)
      .setTimestamp()
    );

    const regBtn = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('📜 Regulamin')
      .setURL(`https://discord.com/channels/${member.guild.id}/${REGULAMIN_CHANNEL_ID}`);

    await ch.send({ embeds: [welcomeEmbed], components: [ new ActionRowBuilder().addComponents(regBtn) ] });
  } catch (err) {
    console.error("Błąd powitania:", err);
  }
});

// KOMENDA $rr – tworzenie reaction-roles
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content !== '$rr') return;

  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.channel.send('Tylko administratorzy mogą używać tej komendy.');
  }

  const filter = m => m.author.id === message.author.id;

  // 1) wybór kanału
  await message.channel.send('1) Wskaż kanał (np. #nazwa):');
  let collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
  if (!collected?.size) return message.channel.send('Czas minął, anulowano.');
  const target = collected.first().mentions.channels.first();
  if (!target) return message.channel.send('Nieprawidłowy kanał.');

  // 2) tytuł
  await message.channel.send('2) Podaj tytuł embeda:');
  collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
  if (!collected?.size) return message.channel.send('Czas minął, anulowano.');
  const title = collected.first().content;

  // 3) treść embeda
  await message.channel.send('3) Podaj treść embeda:');
  collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
  if (!collected?.size) return message.channel.send('Czas minął, anulowano.');
  const embedText = collected.first().content;

  // 4) zbieranie par emoji→rola
  const pairs = [];
  await message.channel.send('4) Podaj `:emotka: @rola`. Napisz `koniec`, aby zakończyć.');
  while (true) {
    collected = await message.channel.awaitMessages({ filter, max: 1, time: 120000 }).catch(() => null);
    if (!collected?.size) return message.channel.send('Czas minął, anulowano.');
    const entry = collected.first().content.trim();
    if (entry.toLowerCase() === 'koniec') break;
    const match = entry.match(/(<a?:\w+:(\d+)>|\p{Emoji_Presentation})\s+<@&(\d+)>/u);
    if (!match) {
      await message.channel.send('Zły format, podaj `:emotka: @rola`.');
      continue;
    }
    pairs.push({ emoji: match[1], roleId: match[3] });
    await message.channel.send(`Dodano: ${match[1]} → <@&${match[3]}>`);
  }

  // Tworzenie i wysyłka embeda
  const rrEmbed = withFooter(new EmbedBuilder()
    .setTitle(title)
    .setDescription(embedText)
    .setColor(0x00AE86)
  );

  const sent = await target.send({ embeds: [rrEmbed] });
  dynamicReactionRoleMap.set(sent.id, {});
  for (const { emoji, roleId } of pairs) {
    await sent.react(emoji).catch(() => {});
    const key = emoji.match(/<a?:\w+:(\d+)>/)?.[1] || emoji;
    dynamicReactionRoleMap.get(sent.id)[key] = { roleId, singleChoice: false };
  }

  message.channel.send(`✅ Reaction roles utworzone na kanale ${target}`);
});

// TICKET SYSTEM – komendy i interakcje
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content.startsWith('$ticket zglos') || message.content.startsWith('$ticket pomoc')) {
    const isReport = message.content.startsWith('$ticket zglos');
    const ticketEmbed = withFooter(new EmbedBuilder()
      .setTitle(isReport ? 'ZGŁOŚ UŻYTKOWNIKA' : 'ZGŁOŚ PROBLEM')
      .setDescription(isReport 
        ? 'Kliknij przycisk, aby zgłosić użytkownika.' 
        : 'Kliknij przycisk, aby zgłosić problem.')
      .setColor(isReport ? 0xFF0000 : 0x00AE86)
    );

    const btn = new ButtonBuilder()
      .setCustomId(isReport ? 'create_ticket_zglos' : 'create_ticket_pomoc')
      .setLabel(isReport ? '⚠️ Zgłoś użytkownika' : '🔨 Zgłoś problem')
      .setStyle(isReport ? ButtonStyle.Danger : ButtonStyle.Primary);

    await message.channel.send({
      embeds: [ticketEmbed],
      components: [ new ActionRowBuilder().addComponents(btn) ]
    });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // Tworzenie ticketu
  if (interaction.customId === 'create_ticket_zglos' || interaction.customId === 'create_ticket_pomoc') {
    const isReport = interaction.customId === 'create_ticket_zglos';
    const channelName = `${isReport ? 'zglos' : 'pomoc'}-${interaction.user.username}`;
    try {
      const ticketCh = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_OPEN,
        permissionOverwrites: [
          { id: interaction.guild.id,        deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id,         allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID,               allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });

      await ticketCh.send(`<@${interaction.user.id}>`);

      const followupEmbed = withFooter(new EmbedBuilder()
        .setTitle(isReport ? 'ZGŁOŚ UŻYTKOWNIKA' : 'ZGŁOŚ PROBLEM')
        .setDescription(isReport ? 'Opisz użytkownika i powód.' : 'Opisz swój problem.')
        .setColor(isReport ? 0xFF0000 : 0x00AE86)
      );
      const closeBtn = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Zamknij Ticket')
        .setStyle(ButtonStyle.Danger);

      await ticketCh.send({
        embeds: [followupEmbed],
        components: [ new ActionRowBuilder().addComponents(closeBtn) ]
      });

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

// HANDLER REAKCJI — tylko pod botowymi wiadomościami
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.author.id !== client.user.id) return;

  const dataMap = dynamicReactionRoleMap.get(reaction.message.id);
  if (!dataMap) return;
  const key = reaction.emoji.id || reaction.emoji.toString();
  const data = dataMap[key];
  if (!data) return;

  const member = await reaction.message.guild.members.fetch(user.id);
  if (!member.roles.cache.has(data.roleId)) {
    await member.roles.add(data.roleId).catch(() => {});
  }
});

client.login(process.env.TOKEN);
