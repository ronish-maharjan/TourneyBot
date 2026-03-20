import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getGiveawayConfig, setGiveawayConfig, updateGiveawayPingRole, addGiveawayChannel, removeGiveawayChannel, getGiveawayChannels, getGiveawayById } from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('giveaway').setDescription('Giveaway system')
  .addSubcommand(s => s.setName('setup').setDescription('Configure giveaway system')
    .addRoleOption(o => o.setName('staff_role').setDescription('Staff role').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Add giveaway channel').setRequired(false))
    .addRoleOption(o => o.setName('ping_role').setDescription('Ping role').setRequired(false))
    .addBooleanOption(o => o.setName('clear_ping').setDescription('Clear ping role').setRequired(false)))
  .addSubcommand(s => s.setName('removechannel').setDescription('Remove giveaway channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
  .addSubcommand(s => s.setName('cleanup').setDescription('Remove deleted channels from giveaway config'))
  .addSubcommand(s => s.setName('config').setDescription('View giveaway config'))
  .addSubcommand(s => s.setName('create').setDescription('Create a giveaway'))
  .addSubcommand(s => s.setName('end').setDescription('End giveaway early (Staff)').addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
  .addSubcommand(s => s.setName('reroll').setDescription('Reroll winner (Staff)').addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup':         return handleSetup(interaction);
    case 'removechannel': return handleRemoveChannel(interaction);
    case 'cleanup':       return handleCleanup(interaction);
    case 'config':        return handleConfig(interaction);
    case 'create':        return handleCreate(interaction);
    case 'end':           return handleEnd(interaction);
    case 'reroll':        return handleReroll(interaction);
  }
}

// ═════════════════════════════════════════════════════════════════
//  SETUP
// ═════════════════════════════════════════════════════════════════

async function handleSetup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '❌ Need **Manage Server**.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const staffRole = interaction.options.getRole('staff_role');
  const channel = interaction.options.getChannel('channel');
  const pingRole = interaction.options.getRole('ping_role');
  const clearPing = interaction.options.getBoolean('clear_ping') ?? false;

  if (!staffRole && !channel && !pingRole && !clearPing) return interaction.editReply({ content: '❌ Provide at least one option.\n\n**Example:** `/giveaway setup staff_role:@Staff channel:#giveaways`' });

  const changes = [], errors = [];

  if (staffRole) {
    if (staffRole.managed || staffRole.id === interaction.guild.id) { errors.push('❌ **Staff Role:** Invalid.'); }
    else {
      const existing = await getGiveawayConfig(interaction.guildId);
      await setGiveawayConfig(interaction.guildId, staffRole.id, existing?.ping_role_id || null);
      changes.push(`✅ **Staff Role:** <@&${staffRole.id}>`);
    }
  }

  if (channel) {
    const config = await getGiveawayConfig(interaction.guildId);
    if (!config && !staffRole) { errors.push('❌ **Channel:** Set staff_role first.'); }
    else if (!channel.isTextBased()) { errors.push('❌ **Channel:** Must be text.'); }
    else {
      const existing = await getGiveawayChannels(interaction.guildId);
      if (existing.length >= 10) errors.push('❌ **Channel:** Max 10.');
      else if (existing.some(c => c.channel_id === channel.id)) errors.push(`⚠️ **Channel:** Already added.`);
      else {
        const perms = channel.permissionsFor(interaction.guild.members.me);
        if (!perms?.has(['SendMessages', 'EmbedLinks'])) errors.push('❌ **Channel:** No send permission.');
        else { await addGiveawayChannel(interaction.guildId, channel.id); const t = (await getGiveawayChannels(interaction.guildId)).length; changes.push(`✅ **Channel:** <#${channel.id}> (${t} total)`); }
      }
    }
  }

  if (clearPing) {
    const config = await getGiveawayConfig(interaction.guildId);
    if (config) { await updateGiveawayPingRole(interaction.guildId, null); changes.push('✅ **Ping Role:** Cleared → @everyone'); }
    else if (!staffRole) errors.push('❌ **Ping:** Setup first.');
  } else if (pingRole) {
    const config = await getGiveawayConfig(interaction.guildId);
    if (!config && !staffRole) errors.push('❌ **Ping:** Setup first.');
    else if (pingRole.id === interaction.guild.id) { await updateGiveawayPingRole(interaction.guildId, null); changes.push('✅ **Ping Role:** @everyone'); }
    else { await updateGiveawayPingRole(interaction.guildId, pingRole.id); changes.push(`✅ **Ping Role:** <@&${pingRole.id}>`); }
  }

  const embed = new EmbedBuilder().setTimestamp();
  if (changes.length > 0 && errors.length === 0) embed.setTitle('✅ Giveaway Setup Updated').setColor(COLORS.SUCCESS).setDescription(changes.join('\n'));
  else if (changes.length > 0) embed.setTitle('⚠️ Partial Update').setColor(COLORS.WARNING).addFields({ name: 'Applied', value: changes.join('\n') }, { name: 'Issues', value: errors.join('\n') });
  else embed.setTitle('❌ Setup Failed').setColor(COLORS.DANGER).setDescription(errors.join('\n'));

  const config = await getGiveawayConfig(interaction.guildId);
  const channels = await getGiveawayChannels(interaction.guildId);
  if (config) {
    const staff = interaction.guild.roles.cache.get(config.staff_role_id);
    const ping = config.ping_role_id ? interaction.guild.roles.cache.get(config.ping_role_id) : null;
    const chList = channels.length > 0 ? channels.map(c => `<#${c.channel_id}>`).join(', ') : 'None';
    embed.addFields({ name: '📋 Current Config', value: `👥 **Staff:** ${staff ? `<@&${staff.id}>` : 'Unknown'}\n🔔 **Ping:** ${ping ? `<@&${ping.id}>` : '`@everyone`'}\n📢 **Channels:** ${chList}` });
  }
  await interaction.editReply({ embeds: [embed] });
}

// ═════════════════════════════════════════════════════════════════
//  REMOVE CHANNEL
// ═════════════════════════════════════════════════════════════════

async function handleRemoveChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '❌ Need **Manage Server**.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = interaction.options.getChannel('channel', true);
  const existing = await getGiveawayChannels(interaction.guildId);
  if (!existing.some(c => c.channel_id === channel.id)) return interaction.editReply({ content: `❌ <#${channel.id}> not a giveaway channel.` });
  await removeGiveawayChannel(interaction.guildId, channel.id);
  const total = (await getGiveawayChannels(interaction.guildId)).length;
  await interaction.editReply({ content: `✅ Removed <#${channel.id}>. (${total} remaining)` });
}

// ═════════════════════════════════════════════════════════════════
//  CLEANUP — Remove deleted channels
// ═════════════════════════════════════════════════════════════════

async function handleCleanup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Need **Manage Server**.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channels = await getGiveawayChannels(interaction.guildId);
  if (channels.length === 0) {
    return interaction.editReply({ content: '📭 No giveaway channels configured.' });
  }

  let removed = 0;
  for (const ch of channels) {
    try {
      const resolved = await interaction.guild.channels.fetch(ch.channel_id).catch(() => null);
      if (!resolved) {
        await removeGiveawayChannel(interaction.guildId, ch.channel_id);
        removed++;
      }
    } catch {
      await removeGiveawayChannel(interaction.guildId, ch.channel_id);
      removed++;
    }
  }

  if (removed === 0) {
    return interaction.editReply({ content: '✅ All giveaway channels are valid. Nothing to clean up.' });
  }

  const remaining = (await getGiveawayChannels(interaction.guildId)).length;
  await interaction.editReply({
    content: `🧹 Cleaned up **${removed}** deleted channel(s).\n📢 Remaining channels: **${remaining}**`,
  });
}

// ═════════════════════════════════════════════════════════════════
//  CONFIG — View settings (highlights deleted channels)
// ═════════════════════════════════════════════════════════════════

async function handleConfig(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await getGiveawayConfig(interaction.guildId);
  const channels = await getGiveawayChannels(interaction.guildId);
  const embed = new EmbedBuilder().setTitle('⚙️ Giveaway Config').setColor(COLORS.INFO).setTimestamp();

  if (!config) {
    embed.setDescription('📭 Not configured.\n\n```\n/giveaway setup staff_role:@Staff channel:#giveaways\n```');
  } else {
    // Staff role check
    const staff = interaction.guild.roles.cache.get(config.staff_role_id);
    const staffDisplay = staff ? `<@&${staff.id}>` : '⚠️ ~~Deleted Role~~';

    // Ping role check
    let pingDisplay = '`@everyone` _(default)_';
    if (config.ping_role_id) {
      const pingRole = interaction.guild.roles.cache.get(config.ping_role_id);
      pingDisplay = pingRole ? `<@&${pingRole.id}>` : '⚠️ ~~Deleted Role~~';
    }

    // Channel check — verify each one
    let channelList = 'None — add with `/giveaway setup channel:#channel`';
    let hasDeleted = false;

    if (channels.length > 0) {
      const lines = [];
      for (let i = 0; i < channels.length; i++) {
        try {
          const ch = await interaction.guild.channels.fetch(channels[i].channel_id).catch(() => null);
          if (ch) {
            lines.push(`**${i + 1}.** <#${channels[i].channel_id}>`);
          } else {
            lines.push(`**${i + 1}.** ⚠️ ~~Deleted Channel~~ (\`${channels[i].channel_id}\`)`);
            hasDeleted = true;
          }
        } catch {
          lines.push(`**${i + 1}.** ⚠️ ~~Deleted Channel~~ (\`${channels[i].channel_id}\`)`);
          hasDeleted = true;
        }
      }
      channelList = lines.join('\n');
    }

    embed.addFields(
      { name: '👥 Staff Role', value: staffDisplay, inline: true },
      { name: '🔔 Ping Role', value: pingDisplay, inline: true },
      { name: `📢 Channels (${channels.length}/10)`, value: channelList, inline: false },
    );

    if (hasDeleted) {
      embed.addFields({
        name: '⚠️ Deleted Channels Found',
        value: 'Run `/giveaway cleanup` to remove deleted channels.',
      });
    }

    if (!staff) {
      embed.addFields({
        name: '⚠️ Staff Role Deleted',
        value: 'Run `/giveaway setup staff_role:@NewRole` to fix.',
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

// ═════════════════════════════════════════════════════════════════
//  CREATE
// ═════════════════════════════════════════════════════════════════

async function handleCreate(interaction) {
  const config = await getGiveawayConfig(interaction.guildId);
  const channels = await getGiveawayChannels(interaction.guildId);
  if (!config) return interaction.reply({ content: '❌ Not configured. Ask admin: `/giveaway setup`.', flags: MessageFlags.Ephemeral });
  if (channels.length === 0) return interaction.reply({ content: '❌ No channels. Ask admin: `/giveaway setup channel:#channel`.', flags: MessageFlags.Ephemeral });

  const modal = new ModalBuilder().setCustomId('modal_giveaway_create').setTitle('Create a Giveaway');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('What are you giving away?').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Shiny Charizard').setMinLength(2).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration in minutes (1-10080)').setStyle(TextInputStyle.Short).setPlaceholder('60').setMinLength(1).setMaxLength(5).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winners').setLabel('Number of winners (1-10)').setStyle(TextInputStyle.Short).setPlaceholder('1').setValue('1').setMinLength(1).setMaxLength(2).setRequired(true)),
  );
  await interaction.showModal(modal);
}

// ═════════════════════════════════════════════════════════════════
//  END
// ═════════════════════════════════════════════════════════════════

async function handleEnd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await getGiveawayConfig(interaction.guildId);
  if (!config) return interaction.editReply({ content: '❌ Not configured.' });
  if (!interaction.member.roles.cache.has(config.staff_role_id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply({ content: '❌ Staff only.' });
  const giveaway = await getGiveawayById(interaction.options.getInteger('id', true));
  if (!giveaway || giveaway.guild_id !== interaction.guildId) return interaction.editReply({ content: '❌ Not found.' });
  if (giveaway.status !== 'approved') return interaction.editReply({ content: `❌ Not active (${giveaway.status}).` });
  const { endGiveaway } = await import('../../services/giveawayService.js');
  await endGiveaway(interaction.guild, giveaway);
  await interaction.editReply({ content: `✅ Giveaway **#${giveaway.id}** ended!` });
}

// ═════════════════════════════════════════════════════════════════
//  REROLL
// ═════════════════════════════════════════════════════════════════

async function handleReroll(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await getGiveawayConfig(interaction.guildId);
  if (!config) return interaction.editReply({ content: '❌ Not configured.' });
  if (!interaction.member.roles.cache.has(config.staff_role_id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply({ content: '❌ Staff only.' });
  const giveaway = await getGiveawayById(interaction.options.getInteger('id', true));
  if (!giveaway || giveaway.guild_id !== interaction.guildId) return interaction.editReply({ content: '❌ Not found.' });
  if (giveaway.status !== 'ended') return interaction.editReply({ content: '❌ Can only reroll ended giveaways.' });
  const { rerollGiveaway } = await import('../../services/giveawayService.js');
  await rerollGiveaway(interaction.guild, giveaway);
  await interaction.editReply({ content: `✅ Giveaway **#${giveaway.id}** rerolled!` });
}
