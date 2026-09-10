import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  PermissionFlagsBits 
} from 'discord.js';

// === CONFIGURATION ===
const BOT_TOKEN = process.env.BOT_TOKEN || "PASTE_YOUR_ACTIVE_TOKEN_HERE";
const CLIENT_ID = "1546528222198632471";
const ORDERS_CHANNEL_ID = "1543601300527255592";
const DEFAULT_DEVELOPER_NAME = "SkyVibe19751207";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Send a commission status update DM to a buyer')
    .addUserOption(opt =>
      opt.setName('client')
        .setDescription('The client receiving the status DM')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('order_id')
        .setDescription('Order ID (e.g. ORD-104928)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('status')
        .setDescription('Current commission stage')
        .setRequired(true)
        .addChoices(
          { name: '🟡 Pending / Queued', value: 'Pending' },
          { name: '🔵 In Progress / Working', value: 'In Progress' },
          { name: '🟣 Testing / QA Review', value: 'In Review' },
          { name: '🟢 Completed / Ready for Delivery', value: 'Completed' },
          { name: '🔴 Needs Information / Waiting on Client', value: 'Action Required' }
        )
    )
    .addStringOption(opt =>
      opt.setName('note')
        .setDescription('Progress notes')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('reassign')
    .setDescription('Transfer an active commission to another developer')
    .addStringOption(opt =>
      opt.setName('order_id')
        .setDescription('The Order ID to reassign')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('developer')
        .setDescription('The developer taking over')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for handoff')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('orderinfo')
    .setDescription('Look up and display an active commission embed')
    .addStringOption(opt =>
      opt.setName('order_id')
        .setDescription('Order reference')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('client')
        .setDescription('Client user')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('developer')
        .setDescription('Lead developer')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('details')
        .setDescription('Order summary notes')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
];

// Register slash commands globally
async function registerCommands(appId) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log(`🔄 Registering commands for Application ID: ${appId}...`);
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('✅ Slash commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// Find member by ID, Username, or Nickname
async function resolveDeveloper(guild, searchName) {
  if (!guild) return null;
  const query = (searchName || DEFAULT_DEVELOPER_NAME).toLowerCase().trim();

  try {
    const members = await guild.members.fetch();
    return members.find(m =>
      m.id === query ||
      m.user.username.toLowerCase() === query ||
      (m.nickname && m.nickname.toLowerCase() === query) ||
      m.displayName.toLowerCase() === query
    ) || null;
  } catch (err) {
    console.error('Error fetching members:', err);
    return null;
  }
}

// Listen for incoming webhook orders in the single order channel
client.on('messageCreate', async (message) => {
  if (message.channelId !== ORDERS_CHANNEL_ID || !message.webhookId) return;

  await new Promise(r => setTimeout(r, 750));

  let targetMsg = message;
  try {
    targetMsg = await message.channel.messages.fetch(message.id);
  } catch {}

  const rawEmbed = targetMsg.embeds?.[0];
  if (!rawEmbed) return;

  const fields = rawEmbed.fields || [];
  const orderIdField = fields.find(f => f.name === 'Order ID');
  const clientField = fields.find(f => f.name === 'Client Name');
  const devField = fields.find(f => f.name === 'Preferred Developer');

  let orderId = orderIdField ? orderIdField.value.replace(/`/g, '') : null;
  if (!orderId && targetMsg.content) {
    const match = targetMsg.content.match(/ORD-\d+/);
    if (match) orderId = match[0];
  }
  if (!orderId) orderId = 'ORD-ACTIVE';

  const clientName = clientField ? clientField.value : 'Customer';
  const requestedDevName = devField ? devField.value : DEFAULT_DEVELOPER_NAME;

  try {
    const targetGuild = targetMsg.guild || await client.guilds.fetch(targetMsg.guildId);
    const matchedDev = await resolveDeveloper(targetGuild, requestedDevName);

    await targetMsg.delete().catch(() => {});

    const interactiveEmbed = new EmbedBuilder()
      .setTitle(`📦 Commission Intake: ${orderId}`)
      .setColor(rawEmbed.color || 0x06b6d4)
      .setDescription(`**Client:** ${clientName}\n**Assigned Dev:** ${matchedDev ? `<@${matchedDev.id}>` : requestedDevName}`)
      .addFields(fields.length > 0 ? fields : [{ name: 'Order Info', value: 'Order logged.' }])
      .setFooter({ text: `Order ID: ${orderId} • Click below to reassign` })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`reassign_btn_${orderId}`)
        .setLabel('🔄 Reassign Developer')
        .setStyle(ButtonStyle.Primary)
    );

    const pingText = matchedDev 
      ? `🚨 **New Order Received!** Attention <@${matchedDev.id}>: You are assigned to **${orderId}**!`
      : `🚨 **New Order Received!** Developer @${DEFAULT_DEVELOPER_NAME}: Order **${orderId}** needs allocation!`;

    await targetMsg.channel.send({
      content: pingText,
      embeds: [interactiveEmbed],
      components: [actionRow],
      allowedMentions: { parse: ['users', 'roles'] }
    });
  } catch (err) {
    console.error('Error posting order embed:', err);
  }
});

// Interactions (Commands, Buttons, Modals)
client.on('interactionCreate', async (interaction) => {
  // /update
  if (interaction.isChatInputCommand() && interaction.commandName === 'update') {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('client');
    const orderId = interaction.options.getString('order_id');
    const status = interaction.options.getString('status');
    const note = interaction.options.getString('note') || 'Your commission is currently being processed.';

    const statusColors = {
      'Pending': 0xf59e0b,
      'In Progress': 0x06b6d4,
      'In Review': 0x8b5cf6,
      'Completed': 0x10b981,
      'Action Required': 0xef4444
    };

    const dmEmbed = new EmbedBuilder()
      .setTitle(`🛠️ Commission Update: ${orderId}`)
      .setColor(statusColors[status] || 0x00e5ff)
      .setDescription(`Hello <@${targetUser.id}>, here is the latest update on your order:`)
      .addFields(
        { name: 'Order ID', value: `\`${orderId}\``, inline: true },
        { name: 'Current Status', value: `**${status.toUpperCase()}**`, inline: true },
        { name: 'Handled By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Progress Notes', value: note }
      )
      .setFooter({ text: 'Dev Operations • Reply in server tickets if you have questions' })
      .setTimestamp();

    try {
      await targetUser.send({ embeds: [dmEmbed] });

      const channel = await client.channels.fetch(ORDERS_CHANNEL_ID);
      if (channel) {
        const staffLog = new EmbedBuilder()
          .setTitle(`📡 Live Update Dispatched: ${orderId}`)
          .setColor(statusColors[status] || 0x00e5ff)
          .addFields(
            { name: 'Order ID', value: `\`${orderId}\``, inline: true },
            { name: 'Client', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'Status', value: status, inline: true },
            { name: 'Note', value: note }
          )
          .setFooter({ text: `Dispatched by ${interaction.user.tag}` })
          .setTimestamp();

        await channel.send({ embeds: [staffLog] });
      }

      await interaction.editReply({ content: `✅ DM dispatched to **${targetUser.tag}** for Order **${orderId}**.` });
    } catch {
      await interaction.editReply({ content: `⚠️ Could not deliver DM to **${targetUser.tag}**. Their direct messages may be closed.` });
    }
  }

  // /reassign
  if (interaction.isChatInputCommand() && interaction.commandName === 'reassign') {
    await interaction.deferReply({ ephemeral: false });

    const orderId = interaction.options.getString('order_id');
    const newDev = interaction.options.getUser('developer');
    const reason = interaction.options.getString('reason') || 'Developer handoff';

    const reassignEmbed = new EmbedBuilder()
      .setTitle(`🔄 Commission Reassigned: ${orderId}`)
      .setColor(0x8b5cf6)
      .setDescription(`Commission **${orderId}** has been reassigned to <@${newDev.id}>.`)
      .addFields(
        { name: 'Previous Lead', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'New Assigned Lead', value: `<@${newDev.id}>`, inline: true },
        { name: 'Reason / Notes', value: reason }
      )
      .setFooter({ text: `Action by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({
      content: `🔔 Attention <@${newDev.id}>: You have been assigned to lead Order **${orderId}**!`,
      embeds: [reassignEmbed],
      allowedMentions: { parse: ['users'] }
    });
  }

  // /orderinfo
  if (interaction.isChatInputCommand() && interaction.commandName === 'orderinfo') {
    await interaction.deferReply({ ephemeral: false });

    const orderId = interaction.options.getString('order_id');
    const clientUser = interaction.options.getUser('client');
    const devUser = interaction.options.getUser('developer');
    const details = interaction.options.getString('details') || 'No additional notes.';

    const infoEmbed = new EmbedBuilder()
      .setTitle(`📋 Commission Record: ${orderId}`)
      .setColor(0x06b6d4)
      .addFields(
        { name: 'Order ID', value: `\`${orderId}\``, inline: true },
        { name: 'Client', value: `<@${clientUser.id}>`, inline: true },
        { name: 'Assigned Dev', value: `<@${devUser.id}>`, inline: true },
        { name: 'Details', value: details }
      )
      .setFooter({ text: `Recorded by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [infoEmbed] });
  }

  // Modal Open Button
  if (interaction.isButton() && interaction.customId.startsWith('reassign_btn_')) {
    const orderId = interaction.customId.replace('reassign_btn_', '');

    const modal = new ModalBuilder()
      .setCustomId(`reassign_modal_${orderId}`)
      .setTitle(`Reassign Order: ${orderId}`);

    const devInput = new TextInputBuilder()
      .setCustomId('new_dev_input')
      .setLabel('New Developer Username or ID')
      .setPlaceholder('e.g. SkyVibe19751207 or numeric Discord ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason_input')
      .setLabel('Reason / Handoff Notes')
      .setPlaceholder('e.g. Workload redistribution...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(devInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    await interaction.showModal(modal);
  }

  // Modal Submission
  if (interaction.isModalSubmit() && interaction.customId.startsWith('reassign_modal_')) {
    await interaction.deferReply({ ephemeral: false });

    const orderId = interaction.customId.replace('reassign_modal_', '');
    const newDevQuery = interaction.fields.getTextInputValue('new_dev_input').trim();
    const handoffReason = interaction.fields.getTextInputValue('reason_input') || 'No reason provided';

    const matchedDev = await resolveDeveloper(interaction.guild, newDevQuery);

    if (!matchedDev) {
      await interaction.editReply({
        content: `❌ Could not find member **${newDevQuery}** in this server.`
      });
      return;
    }

    const reassignEmbed = new EmbedBuilder()
      .setTitle(`🔄 Commission Reassigned: ${orderId}`)
      .setColor(0x8b5cf6)
      .setDescription(`Order **${orderId}** has been transferred to <@${matchedDev.id}>.`)
      .addFields(
        { name: 'Previous Lead', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'New Lead Developer', value: `<@${matchedDev.id}> (${matchedDev.user.tag})`, inline: true },
        { name: 'Reason / Notes', value: handoffReason }
      )
      .setFooter({ text: `Reassigned by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({
      content: `🔔 Attention <@${matchedDev.id}>: You have taken over commission **${orderId}**!`,
      embeds: [reassignEmbed],
      allowedMentions: { parse: ['users'] }
    });
  }
});

client.once('ready', async () => {
  console.log(`🤖 Bot online as: ${client.user.tag}`);
  await registerCommands(CLIENT_ID || client.user.id);
});

client.login(BOT_TOKEN);
