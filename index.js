const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, SlashCommandBuilder, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ------- KONFIGURACJA -------
const REGULAMIN_CHANNEL_ID = '1348705958939066396';
const WELCOME_CHANNEL_ID   = '1348705958939066393';
const TICKET_CATEGORY_ID   = '1350857928583807039';
const CLOSED_CATEGORY_ID   = '1350857964675661885';
const SUPPORT_ROLE_ID      = '1350176648368230601';

// ------- PLIK REACTION ROLES -------
const ROLES_FILE = path.join(__dirname, 'reaction_roles.json');
if (!fs.existsSync(ROLES_FILE)) fs.writeFileSync(ROLES_FILE, JSON.stringify({}, null, 2));
let reactionRoles = {};
try { reactionRoles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8')); }
catch (err) { console.error('Błąd odczytu reaction_roles.json:', err); }

// ------- POMOCNICZY: STOPKA -------
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

client.commands = new Collection();
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Odpowiada pongiem.'),
];
for (const command of commands) client.commands.set(command.name, command);

client.once('ready', async () => {
  console.log(`Bot zalogowany jako ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands zarejestrowane.');
  } catch (error) {
    console.error('Błąd rejestracji slash commands:', error);
  }

  for (const msgId in reactionRoles) {
    try {
      const conf = reactionRoles[msgId];
      const channel = await client.channels.fetch(conf.channelId);
      if (channel?.isTextBased()) await channel.messages.fetch(msgId);
    } catch {}
  }
});

// ------- KOMENDY -------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});

// ------- POWITANIE NOWYCH CZŁONKÓW -------
client.on('guildMemberAdd', async member => {
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
  } catch (err) { console.error('Błąd powitania:', err); }
});

// ------- OBSŁUGA BUTTONÓW (TICKETY) -------
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const { customId, user, guild } = interaction;
  if (customId === 'report_user' || customId === 'report_problem') {
    const clean = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = `ticket-${clean}-${user.discriminator}`;
    const ticket = await guild.channels.create({
      name, type: ChannelType.GuildText, parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ]
    });
    await interaction.reply({ content: `Ticket utworzony: <#${ticket.id}>`, ephemeral: true });
    const embed = new EmbedBuilder()
      .setDescription('Opisz swój problem lub zachowanie użytkownika tutaj. Po zakończeniu kliknij **Zamknij Ticket**.')
      .setColor('Blue');
    withFooter(embed);
    await ticket.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Zamknij Ticket').setStyle(ButtonStyle.Danger)
      )]
    });
  }
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

// ------- SYSTEM REACTION ROLES -------
async function handleReaction(reaction, user, add) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const conf = reactionRoles[reaction.message.id];
    if (!conf) return;

    const reacted = reaction.emoji.toString();
    const entry = conf.pairs.find(x => x.emoji === reacted);
    if (!entry) return;

    const member = await reaction.message.guild.members.fetch(user.id);

    if (conf.exclusive && add) {
      for (const other of conf.pairs) {
        if (other.roleId !== entry.roleId) {
          await member.roles.remove(other.roleId).catch(() => {});
        }
      }
    }

    if (add) await member.roles.add(entry.roleId);
    else    await member.roles.remove(entry.roleId);

  } catch (err) {
    console.error('Reaction role error:', err);
  }
}
client.on('messageReactionAdd',    (r,u) => handleReaction(r,u,true));
client.on('messageReactionRemove', (r,u) => handleReaction(r,u,false));

// ------- KOMENDA $rr (Reaction Role) INTERAKTYWNIE -------
client.on('messageCreate', async message => {
  if (message.content !== '$rr' || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return;
  const filter  = m => m.author.id === message.author.id;
  const TIMEOUT = 180000;

  try {
    await message.channel.send('Na jakim kanale ma być wiadomość? (podaj #nazwakanału)');
    const chanMsg = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT });
    const chan    = chanMsg.first().mentions.channels.first();
    if (!chan) throw new Error();

    await message.channel.send('Podaj tytuł embeda:');
    const title = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Podaj treść embeda:');
    const description = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Podaj kolor embeda:');
    const color = (await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content;

    await message.channel.send('Czy role mają być jednokrotnego wyboru? (tak/nie)');
    const exclusive = ((await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT })).first().content.toLowerCase() === 'tak');

    const pairs = [];
    await message.channel.send("Podaj reakcję i rolę (emoji @rola). Wpisz 'gotowe' by zakończyć.");
    while (true) {
      const resp = await message.channel.awaitMessages({ filter, max: 1, time: TIMEOUT });
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

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
    withFooter(embed);
    const sent = await chan.send({ embeds: [embed] });
    for (const p of pairs) await sent.react(p.emoji);

    reactionRoles[sent.id] = { channelId: chan.id, exclusive, pairs };
    fs.writeFileSync(ROLES_FILE, JSON.stringify(reactionRoles, null, 2));

    await message.channel.send('Reaction role utworzone!');
  } catch {
    message.channel.send('Coś poszło nie tak lub czas minął.');
  }
});

client.login(process.env.TOKEN);
