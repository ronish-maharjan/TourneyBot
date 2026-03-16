// ─── src/commands/admin/giveaway.js ──────────────────────────────
// /giveaway setup|removechannel|config|create|end|reroll

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
  createGiveaway,
  getGiveawayById,
} from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Giveaway system')

  // ── Setup: all-in-one configuration ────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription('Configure giveaway system (all options optional — updates only what you provide)')
      .addRoleOption(opt =>
        opt.setName('staff_role').setDescription('Role for giveaway staff who approve/reject').setRequired(false),
      )
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Add a giveaway channel').setRequired(false),
      )
      .addRoleOption(opt =>
        opt.setName('ping_role').setDescription('Role to ping when giveaway is published (default: @everyone)').setRequired(false),
      )
      .addBooleanOption(opt =>
        opt.setName('clear_ping').setDescription('Clear ping role (revert to @everyone)').setRequired(false),
      ),
  )

  // ── Remove channel ─────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('removechannel')
      .setDescription('Remove a giveaway channel')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel to remove').setRequired(true),
      ),
  )

  // ── Config: view current settings ──────────────────────────
  .addSubcommand(sub =>
    sub.setName('config').setDescription('View giveaway configuration'),
  )

  // ── Create: anyone submits a giveaway ──────────────────────
  .addSubcommand(sub =>
    sub.setName('create').setDescription('Create a new giveaway'),
  )

  // ── End: staff ends early ──────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('end')
      .setDescription('End a giveaway early and pick winners (Staff)')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Giveaway ID').setRequired(true),
      ),
  )

  // ── Reroll: staff picks new winner ─────────────────────────
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
    case 'removechannel': return handleRemoveChannel(interaction);
    case 'config':        return handleConfig(interaction);
    case 'create':        return handleCreate(interaction);
    case 'end':           return handleEnd(interaction);
    case 'reroll':        return handleReroll(interaction);
  }
}

// ═════════════════════════════════════════════════════════════════
//  SETUP — All-in-one configuration
// ═════════════════════════════════════════════════════════════════

async function handleSetup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const staffRole = interaction.options.getRole('staff_role');
  const channel   = interaction.options.getChannel('channel');
  const pingRole  = interaction.options.getRole('ping_role');
  const clearPing = interaction.options.getBoolean('clear_ping') ?? false;

  // Check if at least one option provided
  if (!staffRole && !channel && !pingRole && !clearPing) {
    return interaction.editReply({
      content:
        '❌ Provide at least one option:\n\n' +
        '• `staff_role` — Set the staff role\n' +
        '• `channel` — Add a giveaway channel\n' +
        '• `ping_role` — Set the ping role\n' +
        '• `clear_ping` — Revert to @everyone\n\n' +
        '**Example:** `/giveaway setup staff_role:@Staff channel:#giveaways ping_role:@Pings`',
    });
  }

  const changes = [];
  const errors  = [];

  // ── Handle staff role ──────────────────────────────────────
  if (staffRole) {
    if (staffRole.managed || staffRole.id === interaction.guild.id) {
      errors.push('❌ **Staff Role:** Cannot use bot-managed or @everyone role.');
    } else {
      const existing = getGiveawayConfig(interaction.guildId);

      if (existing) {
        // Update existing config — keep ping role
        setGiveawayConfig(interaction.guildId, staffRole.id, existing.ping_role_id);
      } else {
        // First time setup
        setGiveawayConfig(interaction.guildId, staffRole.id, null);
      }

      changes.push(`✅ **Staff Role:** <@&${staffRole.id}>`);
    }
  }

  // ── Handle channel ─────────────────────────────────────────
  if (channel) {
    // Must have config first
    const config = getGiveawayConfig(interaction.guildId);
    if (!config && !staffRole) {
      errors.push('❌ **Channel:** Set `staff_role` first (include it in this command).');
    } else if (!channel.isTextBased()) {
      errors.push('❌ **Channel:** Must be a text channel.');
    } else {
      const existingChannels = getGiveawayChannels(interaction.guildId);

      if (existingChannels.length >= 10) {
        errors.push('❌ **Channel:** Maximum 10 giveaway channels. Remove one first.');
      } else if (existingChannels.some(c => c.channel_id === channel.id)) {
        errors.push(`⚠️ **Channel:** <#${channel.id}> is already a giveaway channel.`);
      } else {
        const botPerms = channel.permissionsFor(interaction.guild.members.me);
        if (!botPerms?.has(['SendMessages', 'EmbedLinks'])) {
          errors.push(`❌ **Channel:** I don't have permission to send messages in <#${channel.id}>.`);
        } else {
          addGiveawayChannel(interaction.guildId, channel.id);
          const total = getGiveawayChannels(interaction.guildId).length;
          changes.push(`✅ **Channel Added:** <#${channel.id}> (${total} total)`);
        }
      }
    }
  }

  // ── Handle ping role ───────────────────────────────────────
  if (clearPing) {
    const config = getGiveawayConfig(interaction.guildId);
    if (config) {
      updateGiveawayPingRole(interaction.guildId, null);
      changes.push('✅ **Ping Role:** Cleared → using `@everyone`');
    } else if (!staffRole) {
      errors.push('❌ **Ping Role:** Run setup with `staff_role` first.');
    }
  } else if (pingRole) {
    const config = getGiveawayConfig(interaction.guildId);
    if (!config && !staffRole) {
      errors.push('❌ **Ping Role:** Set `staff_role` first (include it in this command).');
    } else if (pingRole.id === interaction.guild.id) {
      // @everyone selected — same as clearing
      updateGiveawayPingRole(interaction.guildId, null);
      changes.push('✅ **Ping Role:** Set to `@everyone`');
    } else {
      updateGiveawayPingRole(interaction.guildId, pingRole.id);
      changes.push(`✅ **Ping Role:** <@&${pingRole.id}>`);
    }
  }

  // ── Build response ─────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTimestamp();

  if (changes.length > 0 && errors.length === 0) {
    embed
      .setTitle('✅ Giveaway Setup Updated')
      .setColor(COLORS.SUCCESS)
      .setDescription(changes.join('\n'));
  } else if (changes.length > 0 && errors.length > 0) {
    embed
      .setTitle('⚠️ Giveaway Setup — Partial Update')
      .setColor(COLORS.WARNING)
      .addFields(
        { name: 'Applied', value: changes.join('\n') },
        { name: 'Issues',  value: errors.join('\n') },
      );
  } else {
    embed
      .setTitle('❌ Giveaway Setup Failed')
      .setColor(COLORS.DANGER)
      .setDescription(errors.join('\n'));
  }

  // Show current config summary
  const config   = getGiveawayConfig(interaction.guildId);
  const channels = getGiveawayChannels(interaction.guildId);

  if (config) {
    const staffDisplay = interaction.guild.roles.cache.get(config.staff_role_id);
    const pingDisplay  = config.ping_role_id
      ? interaction.guild.roles.cache.get(config.ping_role_id)
      : null;

    const chList = channels.length > 0
      ? channels.map(c => `<#${c.channel_id}>`).join(', ')
      : 'None';

    embed.addFields({
      name: '📋 Current Configuration',
      value:
        `👥 **Staff:** ${staffDisplay ? `<@&${staffDisplay.id}>` : 'Unknown'}\n` +
        `🔔 **Ping:** ${pingDisplay ? `<@&${pingDisplay.id}>` : '`@everyone`'}\n` +
        `📢 **Channels:** ${chList}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
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

  const channel  = interaction.options.getChannel('channel', true);
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
      '**Quick setup:**\n' +
      '```\n/giveaway setup staff_role:@Staff channel:#giveaways ping_role:@Pings\n```\n' +
      'All options are optional — set whatever you need.',
    );
  } else {
    const staffRole = interaction.guild.roles.cache.get(config.staff_role_id);
    const staffDisplay = staffRole ? `<@&${staffRole.id}>` : `~~Unknown~~ (\`${config.staff_role_id}\`)`;

    let pingDisplay = '`@everyone` _(default)_';
    if (config.ping_role_id) {
      const pingRole = interaction.guild.roles.cache.get(config.ping_role_id);
      pingDisplay = pingRole ? `<@&${pingRole.id}>` : `~~Unknown~~ (\`${config.ping_role_id}\`)`;
    }

    let channelList = '📭 None — add with `/giveaway setup channel:#channel`';
    if (channels.length > 0) {
      channelList = channels.map((c, i) => {
        const ch = interaction.guild.channels.cache.get(c.channel_id);
        return ch
          ? `**${i + 1}.** <#${c.channel_id}>`
          : `**${i + 1}.** ~~Deleted~~ (\`${c.channel_id}\`)`;
      }).join('\n');
    }

    embed.addFields(
      { name: '👥 Staff Role', value: staffDisplay, inline: true },
      { name: '🔔 Ping Role',  value: pingDisplay,  inline: true },
      { name: `📢 Giveaway Channels (${channels.length}/10)`, value: channelList, inline: false },
    );

    embed.addFields({
      name: '💡 Quick Commands',
      value:
        '• Change staff: `/giveaway setup staff_role:@NewRole`\n' +
        '• Add channel: `/giveaway setup channel:#new-channel`\n' +
        '• Change ping: `/giveaway setup ping_role:@NewPing`\n' +
        '• Clear ping: `/giveaway setup clear_ping:True`\n' +
        '• Remove channel: `/giveaway removechannel channel:#old`',
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ═════════════════════════════════════════════════════════════════
//  CREATE — Anyone submits a giveaway
// ═════════════════════════════════════════════════════════════════

async function handleCreate(interaction) {
  const config   = getGiveawayConfig(interaction.guildId);
  const channels = getGiveawayChannels(interaction.guildId);

  if (!config) {
    return interaction.reply({
      content: '❌ Giveaway system is not configured.\nAsk an admin to run `/giveaway setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (channels.length === 0) {
    return interaction.reply({
      content: '❌ No giveaway channels configured.\nAsk an admin to run `/giveaway setup channel:#channel`.',
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
