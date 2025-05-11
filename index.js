const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');

// ------- KONFIGURACJA -------
const REGULAMIN_CHANNEL_ID = '1348705958939066396';
const WELCOME_CHANNEL_ID = '1348705958939066393';
const TICKET_CATEGORY_ID = '1350857928583807039';
const CLOSED_CATEGORY_ID = '1350857964675661885'; // jeśli brak, ustaw na null lub pusty string
const SUPPORT_ROLE_ID = '1350176648368230601'; // opcjonalnie: rola moderatorów wsparcia

// ------- POMOCNICZY EMITOWANIA FOOTER -------
function withFooter(embed) {
  return embed.setFooter({ text: '© tajgerek' });
}

// ------- INICJACJA KLIENTA -------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', () => {
  console.log(`Bot zalogowany jako ${client.user.tag}`);
});

// ------- POWITANIE NOWYCH CZŁONKÓW -------
client.on('guildMemberAdd', member => {
  const embed = new EmbedBuilder()
    .setTitle('🎉 Witamy na serwerze! 🎉')
    .setDescription('Cieszymy się, że dołączyłeś. Zapoznaj się z regulaminem poniżej.')
    .setColor('Aqua');
  withFooter(embed);

  const rulesButton = new ButtonBuilder()
    .setLabel('📜 Regulamin')
    .setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${member.guild.id}/${REGULAMIN_CHANNEL_ID}`);

  const row = new ActionRowBuilder().addComponents(rulesButton);
  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (welcomeChannel) {
    welcomeChannel.send({ embeds: [embed], components: [row] });
  }
});

// ------- KOMENDY TEKSTOWE ($ticket) -------
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


// ------- OBSŁUGA BUTTONÓW (TICKETY) -------
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const { customId, user, guild } = interaction;

  // Tworzenie nowego ticketu
  if (customId === 'report_user' || customId === 'report_problem') {
    const usernameClean = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const channelName = `ticket-${usernameClean}-${user.discriminator}`;
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        // Dodaj swoją rolę wsparcia, jeśli chcesz dać im dostęp:
        // { id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, ...] }
      ],
    });

    await interaction.reply({ content: `Ticket utworzony: <#${ticketChannel.id}>`, ephemeral: true });

    const ticketEmbed = new EmbedBuilder()
      .setDescription('Opisz swój problem lub zachowanie użytkownika tutaj. Po zakończeniu kliknij **Zamknij Ticket**.')
      .setColor('Blue');
    withFooter(ticketEmbed);

    const closeButton = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Zamknij Ticket')
      .setStyle(ButtonStyle.Danger);
    const closeRow = new ActionRowBuilder().addComponents(closeButton);

    ticketChannel.send({ embeds: [ticketEmbed], components: [closeRow] });
  }

  // Zamknięcie istniejącego ticketu
  if (customId === 'close_ticket') {
    const ticketChannel = interaction.channel;
    if (!ticketChannel || ticketChannel.parentId !== TICKET_CATEGORY_ID) return;

    if (CLOSED_CATEGORY_ID) {
      await ticketChannel.setParent(CLOSED_CATEGORY_ID);
      await ticketChannel.permissionOverwrites.edit(user.id, { SendMessages: false });
      await interaction.reply({ content: 'Ticket został zamknięty i przeniesiony do archiwum.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Ticket zostanie usunięty.', ephemeral: true });
      setTimeout(() => ticketChannel.delete(), 1000);
    }
  }
});

// ------- SYSTEM REACTION ROLES (BEZ ZMIAN) -------
// Wczytanie konfiguracji z pliku JSON
let reactionRoles = {};
try {
  reactionRoles = JSON.parse(fs.readFileSync('reaction_roles.json'));
} catch (err) {
  console.error('Błąd odczytu reaction_roles.json:', err);
}

// Gdy użytkownik doda reakcję – dodajemy rolę
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  const msgRoles = reactionRoles[reaction.message.id];
  if (msgRoles) {
    const entry = msgRoles.find(x => x.emoji === reaction.emoji.name);
    if (entry) {
      const member = await reaction.message.guild.members.fetch(user.id);
      await member.roles.add(entry.roleId);
    }
  }
});

// Gdy użytkownik usunie reakcję – usuwamy rolę
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  const msgRoles = reactionRoles[reaction.message.id];
  if (msgRoles) {
    const entry = msgRoles.find(x => x.emoji === reaction.emoji.name);
    if (entry) {
      const member = await reaction.message.guild.members.fetch(user.id);
      await member.roles.remove(entry.roleId);
    }
  }
});



client.login(process.env.TOKEN);
