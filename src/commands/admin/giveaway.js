// ─── src/commands/admin/giveaway.js ──────────────────────────────
// /giveaway setup|config|pingrole|addchannel|removechannel|create|end|reroll

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getGiveawayConfig,
  setGiveawayConfig,
  updateGiveawayPingRole,
  addGiveawayChannel,
  removeGiveawayChannel,
  getGiveawayChannels,
  getGiveawayById,
} from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Giveaway system')
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription('Set giveaway staff role (Admin)')
      .addRoleOption(opt =>
        opt.setName('staff_role').setDescription('Role for giveaway staff').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('pingrole')
      .setDescription('Set or clear the giveaway ping role (Admin)')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to ping (leave empty to use @everyone)').setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('addchannel')
      .setDescription('Add a giveaway channel (Admin)')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel for giveaways').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('removechannel')
      .setDescription('Remove a giveaway channel (Admin)')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel to remove').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('config').setDescription('View giveaway configuration'),
  )
  .addSubcommand(sub =>
    sub.setName('create').setDescription('Create a new giveaway'),
  )
  .addSubcommand(sub =>
    sub
      .setName('end')
      .setDescription('End a giveaway early (Staff)')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Giveaway ID').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('reroll')
      .setDescription('Reroll giveaway winner(s) (Staff)')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Giveaway ID').setRequired(true),
      ),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup':         return handleSetup(interaction);
    case 'pingrole':      return handlePingRole(interaction);
    case 'addchannel':    return handleAddChannel(interaction);
    case 'removechannel': return handleRemoveChannel(interaction);
    case 'config':        return handleConfig(interaction);
    case 'create':        return handleCreate(interaction);
    case 'end':           return handleEnd(interaction);
    case 'reroll':        return handleReroll(interaction);
  }
}

// ═════════════════════════════════════════════════════════════════
//  SETUP — Set staff role
// ═════════════════════════════════════════════════════════════════

async function handleSetup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role = interaction.options.getRole('staff_role', true);

  if (role.managed || role.id === interaction.guild.id) {
    return interaction.editReply({ content: '❌ Invalid role. Choose a regular server role.' });
  }

  // Preserve existing ping role if config exists
  const existing = getGiveawayConfig(interaction.guildId);
  const pingRoleId = existing?.ping_role_id || null;

  setGiveawayConfig(interaction.guildId, role.id, pingRoleId);

  const embed = new EmbedBuilder()
    .setTitle('✅ Giveaway System Configured')
    .setColor(COLORS.SUCCESS)
    .setDescription(
      `**Staff Role:** <@&${role.id}>\n\n` +
      `Users with this role can approve/reject giveaways.\n\n` +
      `**Next steps:**\n` +
      `• \`/giveaway addchannel\` — Add giveaway channels\n` +
      `• \`/giveaway pingrole\` — Set a ping role (optional, defaults to @everyone)`,
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ═════════════════════════════════════════════════════════════════
//  PING ROLE — Set giveaway ping role
// ═════════════════════════════════════════════════════════════════

async function handlePingRole(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getGiveawayConfig(interaction.guildId);
  if (!config) {
    return interaction.editReply({ content: '❌ Run `/giveaway setup` first.' });
  }

  const role = interaction.options.getRole('role');

  // No role provided or @everyone — clear ping role
  if (!role || role.id === interaction.guild.id) {
    updateGiveawayPingRole(interaction.guildId, null);
    return interaction.editReply({
      content: '✅ Ping role **cleared**. Giveaways will ping `@everyone` instead.',
    });
  }

  updateGiveawayPingRole(interaction.guildId, role.id);

  await interaction.editReply({
    content:
      `✅ Giveaway ping role set to <@&${role.id}>.\n\n` +
      `Only members with this role will be pinged when a giveaway is published.\n` +
      `💡 _Tip: Let members self-assign this role using \`/giverole\` or reaction roles._`,
  });
}

// ═════════════════════════════════════════════════════════════════
//  ADD CHANNEL
// ═════════════════════════════════════════════════════════════════

async function handleAddChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel('channel', true);

  if (!channel.isTextBased()) {
    return interaction.editReply({ content: '❌ Please select a text channel.' });
  }

  const existing = getGiveawayChannels(interaction.guildId);
  if (existing.length >= 10) {
    return interaction.editReply({ content: '❌ Maximum of **10** giveaway channels allowed.' });
  }

  if (existing.some(c => c.channel_id === channel.id)) {
    return interaction.editReply({ content: `❌ <#${channel.id}> is already a giveaway channel.` });
  }

  const botPerms = channel.permissionsFor(interaction.guild.members.me);
  if (!botPerms?.has(['SendMessages', 'EmbedLinks'])) {
    return interaction.editReply({ content: `❌ I don't have permission to send messages in <#${channel.id}>.` });
  }

  addGiveawayChannel(interaction.guildId, channel.id);
  const total = getGiveawayChannels(interaction.guildId).length;

  await interaction.editReply({
    content: `✅ Added <#${channel.id}> as a giveaway channel. (${total} total)`,
  });
}

// ═════════════════════════════════════════════════════════════════
//  REMOVE CHANNEL
// ═════════════════════════════════════════════════════════════════

async function handleRemoveChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel('channel', true);

  const existing = getGiveawayChannels(interaction.guildId);
  if (!existing.some(c => c.channel_id === channel.id)) {
    return interaction.editReply({ content: `❌ <#${channel.id}> is not a giveaway channel.` });
  }

  removeGiveawayChannel(interaction.guildId, channel.id);
  const total = getGiveawayChannels(interaction.guildId).length;

  await interaction.editReply({
    content: `✅ Removed <#${channel.id}> from giveaway channels. (${total} remaining)`,
  });
}

// ═════════════════════════════════════════════════════════════════
//  CONFIG — View settings
// ═════════════════════════════════════════════════════════════════

async function handleConfig(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config   = getGiveawayConfig(interaction.guildId);
  const channels = getGiveawayChannels(interaction.guildId);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Giveaway Configuration')
    .setColor(COLORS.INFO)
    .setTimestamp();

  if (!config) {
    embed.setDescription(
      '📭 Giveaway system is not configured.\n\n' +
      '**Setup steps:**\n' +
      '1. `/giveaway setup` — Set the staff role\n' +
      '2. `/giveaway addchannel` — Add giveaway channels\n' +
      '3. `/giveaway pingrole` — Set ping role (optional)',
    );
  } else {
    const staffRole = interaction.guild.roles.cache.get(config.staff_role_id);
    const staffDisplay = staffRole ? `<@&${staffRole.id}>` : `~~Unknown~~ (\`${config.staff_role_id}\`)`;

    let pingDisplay = '`@everyone` _(default)_';
    if (config.ping_role_id) {
      const pingRole = interaction.guild.roles.cache.get(config.ping_role_id);
      pingDisplay = pingRole ? `<@&${pingRole.id}>` : `~~Unknown~~ (\`${config.ping_role_id}\`)`;
    }

    let channelList = '📭 No channels configured';
    if (channels.length > 0) {
      channelList = channels.map((c, i) => {
        const ch = interaction.guild.channels.cache.get(c.channel_id);
        return ch ? `**${i + 1}.** <#${c.channel_id}>` : `**${i + 1}.** ~~Deleted~~ (\`${c.channel_id}\`)`;
      }).join('\n');
    }

    embed.addFields(
      { name: '👥 Staff Role',   value: staffDisplay, inline: true },
      { name: '🔔 Ping Role',    value: pingDisplay,  inline: true },
      { name: `📢 Giveaway Channels (${channels.length}/10)`, value: channelList, inline: false },
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

// ═════════════════════════════════════════════════════════════════
//  CREATE — Anyone submits a giveaway (opens modal)
// ═════════════════════════════════════════════════════════════════

async function handleCreate(interaction) {
  const config   = getGiveawayConfig(interaction.guildId);
  const channels = getGiveawayChannels(interaction.guildId);

  if (!config) {
    return interaction.reply({
      content: '❌ Giveaway system is not configured. Ask an admin to run `/giveaway setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (channels.length === 0) {
    return interaction.reply({
      content: '❌ No giveaway channels configured. Ask an admin to run `/giveaway addchannel`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal_giveaway_create')
    .setTitle('Create a Giveaway');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('prize')
        .setLabel('What are you giving away?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Shiny Charizard, Nitro, etc.')
        .setMinLength(2)
        .setMaxLength(100)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description / Message (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Any details about the giveaway...')
        .setMaxLength(500)
        .setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Duration in minutes (e.g. 60, 1440 for 1 day)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('60')
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('winners')
        .setLabel('Number of winners (1-10)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1')
        .setValue('1')
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

// ═════════════════════════════════════════════════════════════════
//  END — Staff ends giveaway early
// ═════════════════════════════════════════════════════════════════

async function handleEnd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getGiveawayConfig(interaction.guildId);
  if (!config) {
    return interaction.editReply({ content: '❌ Giveaway system is not configured.' });
  }

  if (!interaction.member.roles.cache.has(config.staff_role_id) &&
      !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply({ content: '❌ Only giveaway staff can end giveaways.' });
  }

  const giveawayId = interaction.options.getInteger('id', true);
  const giveaway   = getGiveawayById(giveawayId);

  if (!giveaway || giveaway.guild_id !== interaction.guildId) {
    return interaction.editReply({ content: '❌ Giveaway not found.' });
  }

  if (giveaway.status !== 'approved') {
    return interaction.editReply({ content: `❌ This giveaway is not active (status: ${giveaway.status}).` });
  }

  const { endGiveaway } = await import('../../services/giveawayService.js');
  await endGiveaway(interaction.guild, giveaway);

  await interaction.editReply({ content: `✅ Giveaway **#${giveawayId}** has been ended! Winners announced.` });
}

// ═════════════════════════════════════════════════════════════════
//  REROLL — Staff picks new winner
// ═════════════════════════════════════════════════════════════════

async function handleReroll(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = getGiveawayConfig(interaction.guildId);
  if (!config) {
    return interaction.editReply({ content: '❌ Giveaway system is not configured.' });
  }

  if (!interaction.member.roles.cache.has(config.staff_role_id) &&
      !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply({ content: '❌ Only giveaway staff can reroll.' });
  }

  const giveawayId = interaction.options.getInteger('id', true);
  const giveaway   = getGiveawayById(giveawayId);

  if (!giveaway || giveaway.guild_id !== interaction.guildId) {
    return interaction.editReply({ content: '❌ Giveaway not found.' });
  }

  if (giveaway.status !== 'ended') {
    return interaction.editReply({ content: '❌ Can only reroll ended giveaways.' });
  }

  const { rerollGiveaway } = await import('../../services/giveawayService.js');
  await rerollGiveaway(interaction.guild, giveaway);

  await interaction.editReply({ content: `✅ Giveaway **#${giveawayId}** has been rerolled! New winner(s) announced.` });
}
