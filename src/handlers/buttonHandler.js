// ─── src/handlers/buttonHandler.js ───────────────────────────────

import {
  MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} from 'discord.js';
import { isOrganizer } from '../utils/permissions.js';
import {
  getTournamentById, getActiveParticipantCount, getMatchById, getParticipant,
  getGiveawayById, getGiveawayConfig, getGiveawayChannels,
  hasEnteredGiveaway, addGiveawayEntry, removeGiveawayEntry,
  getGiveawayEntryCount, updateGiveawayApproval, getCompletedMatchCount, getTotalMatchCount,removeGiveawayChannel
} from '../database/queries.js';
import { COLORS, TOURNAMENT_STATUS, VALID_BEST_OF } from '../config.js';
import {
  openRegistration, closeRegistration, startTournament,
  endTournament, deleteTournamentInfrastructure, buildAdminPanel,
} from '../services/tournamentService.js';
import { registerParticipant, unregisterParticipant, registerSpectator } from '../services/registrationService.js';
import {
  acquireGiveawayLock, releaseGiveawayLock, buildDisabledReviewButtons,
  buildGiveawayEmbed, buildGiveawayButtons,
} from '../services/giveawayService.js';
import { acquireLock, releaseLock, isLocked } from '../services/lockService.js';
import { EMBED_BUILDERS, buildHelpButtons } from '../commands/user/help.js';

export async function handleButton(interaction) {
  const [category, action, ...rest] = interaction.customId.split('_');
  const targetId = rest.join('_');

  switch (category) {
    case 'admin':   return handleAdminButton(interaction, action, targetId);
    case 'reg':     return handleRegButton(interaction, action, targetId);
    case 'match':   return handleMatchButton(interaction, action, targetId);
    case 'confirm': return handleConfirmButton(interaction, action, targetId);
    case 'help':    return handleHelpButton(interaction, action);
    case 'ga':      return handleGiveawayButton(interaction, action, targetId);
    default:
      await interaction.reply({ content: '❓ Unknown action.', flags: MessageFlags.Ephemeral });
  }
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleAdminButton(interaction, action, tournamentId) {
  if (!isOrganizer(interaction.member)) {
    return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });
  }

  const tournament = await getTournamentById(tournamentId);
  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });
  }

  switch (action) {
    case 'configure':  return showConfigureModal(interaction, tournament);
    case 'openreg':    return handleOpenReg(interaction, tournament);
    case 'closereg':   return handleCloseReg(interaction, tournament);
    case 'start':      return showStartConfirmation(interaction, tournament);
    case 'end':        return showEndConfirmation(interaction, tournament);
    case 'delete':     return showDeleteConfirmation(interaction, tournament);
    default:
      await interaction.reply({ content: '❓ Unknown admin action.', flags: MessageFlags.Ephemeral });
  }
}

async function showConfigureModal(interaction, tournament) {
  if ([TOURNAMENT_STATUS.IN_PROGRESS, TOURNAMENT_STATUS.COMPLETED, TOURNAMENT_STATUS.CANCELLED].includes(tournament.status)) {
    return interaction.reply({ content: '❌ Cannot configure after start.', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder().setCustomId(`modal_configure_${tournament.id}`).setTitle('Configure Tournament');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tournament_name').setLabel('Tournament Name').setStyle(TextInputStyle.Short).setValue(tournament.name).setMinLength(2).setMaxLength(50).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max_players').setLabel('Max Players (2–100)').setStyle(TextInputStyle.Short).setValue(`${tournament.max_players}`).setMinLength(1).setMaxLength(3).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_size').setLabel('Team Size (1=Solo, 2=Duo)').setStyle(TextInputStyle.Short).setValue(`${tournament.team_size}`).setMinLength(1).setMaxLength(1).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('best_of').setLabel(`Best Of (${VALID_BEST_OF.join(' or ')})`).setStyle(TextInputStyle.Short).setValue(`${tournament.best_of}`).setMinLength(1).setMaxLength(1).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rules').setLabel('Rules (optional)').setStyle(TextInputStyle.Paragraph).setValue(tournament.rules || '').setMaxLength(1000).setRequired(false)),
  );
  await interaction.showModal(modal);
}

async function handleOpenReg(interaction, tournament) {
  const fresh = await getTournamentById(tournament.id);
  if (![TOURNAMENT_STATUS.CREATED, TOURNAMENT_STATUS.REGISTRATION_CLOSED].includes(fresh.status)) {
    return interaction.reply({ content: '❌ Cannot open registration in this state.', flags: MessageFlags.Ephemeral });
  }

  const lockKey = `tournament_openreg_${tournament.id}`;
  if (!acquireLock(lockKey)) return interaction.reply({ content: '⏳ Already processing.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const recheck = await getTournamentById(tournament.id);
    if (![TOURNAMENT_STATUS.CREATED, TOURNAMENT_STATUS.REGISTRATION_CLOSED].includes(recheck.status)) {
      return interaction.editReply({ content: '❌ Status already changed.' });
    }
    await openRegistration(interaction.guild, recheck);
    await interaction.editReply({ content: '✅ Registration is now **open**!' });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseLock(lockKey); }
}

async function handleCloseReg(interaction, tournament) {
  const fresh = await getTournamentById(tournament.id);
  if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    return interaction.reply({ content: '❌ Registration is not open.', flags: MessageFlags.Ephemeral });
  }

  const lockKey = `tournament_closereg_${tournament.id}`;
  if (!acquireLock(lockKey)) return interaction.reply({ content: '⏳ Already processing.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const recheck = await getTournamentById(tournament.id);
    if (recheck.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) return interaction.editReply({ content: '❌ No longer open.' });
    await closeRegistration(interaction.guild, recheck);
    await interaction.editReply({ content: '✅ Registration is now **closed**.' });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseLock(lockKey); }
}

async function showStartConfirmation(interaction, tournament) {
  const fresh = await getTournamentById(tournament.id);
  if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED) {
    return interaction.reply({ content: '❌ Close registration first.', flags: MessageFlags.Ephemeral });
  }

  const playerCount = await getActiveParticipantCount(tournament.id);
  if (playerCount < 2) return interaction.reply({ content: `❌ Need 2+ players. Currently: **${playerCount}**.`, flags: MessageFlags.Ephemeral });

  const totalMatches = (playerCount * (playerCount - 1)) / 2;
  const embed = new EmbedBuilder().setTitle('⚠️ Start Tournament?').setColor(COLORS.WARNING)
    .setDescription(`Start **${tournament.name}**?\n\n👥 **${playerCount}** players\n⚔️ **${totalMatches}** matches\n📋 Bo${tournament.best_of}\n\nCannot be undone.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_start_${tournament.id}`).setLabel('Start').setEmoji('🚀').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`confirm_no_${tournament.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function showEndConfirmation(interaction, tournament) {
  const fresh = await getTournamentById(tournament.id);
  if (fresh.status !== TOURNAMENT_STATUS.IN_PROGRESS) return interaction.reply({ content: '❌ Not in progress.', flags: MessageFlags.Ephemeral });

  const completed = await getCompletedMatchCount(tournament.id);
  const total = await getTotalMatchCount(tournament.id);

  const embed = new EmbedBuilder().setTitle('⚠️ End Tournament Early?').setColor(COLORS.WARNING)
    .setDescription(`End **${tournament.name}**?\n\n📊 ${completed}/${total} completed\n⚠️ ${total - completed} will be cancelled.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_end_${tournament.id}`).setLabel('End Early').setEmoji('🏁').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`confirm_no_${tournament.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function showDeleteConfirmation(interaction, tournament) {
  const embed = new EmbedBuilder().setTitle('⚠️ Delete Tournament?').setColor(COLORS.DANGER)
    .setDescription(`**Permanently delete** all channels, roles, data for **${tournament.name}**?\n\n⚠️ **Cannot be undone!**`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_delete_${tournament.id}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`confirm_no_${tournament.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// ═════════════════════════════════════════════════════════════════
//  CONFIRMATION BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleConfirmButton(interaction, action, targetId) {
  if (action === 'no') return interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });

  const tournament = await getTournamentById(targetId);
  if (!tournament) return interaction.update({ content: '❌ Not found.', embeds: [], components: [] });

  switch (action) {
    case 'start':  return executeStart(interaction, tournament);
    case 'end':    return executeEnd(interaction, tournament);
    case 'delete': return executeDelete(interaction, tournament);
    default: await interaction.update({ content: '❓ Unknown.', embeds: [], components: [] });
  }
}

async function executeStart(interaction, tournament) {
  const lockKey = `tournament_start_${tournament.id}`;
  if (!acquireLock(lockKey)) return interaction.update({ content: '⏳ Already starting.', embeds: [], components: [] });

  await interaction.update({ content: '⏳ Starting tournament…', embeds: [], components: [] });
  try {
    const fresh = await getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED) return interaction.editReply({ content: '❌ State changed.' });
    await startTournament(interaction.guild, fresh);
    await interaction.editReply({ content: '✅ Tournament **started**!' });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseLock(lockKey); }
}

async function executeEnd(interaction, tournament) {
  const lockKey = `tournament_end_${tournament.id}`;
  if (!acquireLock(lockKey)) return interaction.update({ content: '⏳ Already ending.', embeds: [], components: [] });

  await interaction.update({ content: '⏳ Ending tournament…', embeds: [], components: [] });
  try {
    const fresh = await getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.IN_PROGRESS) return interaction.editReply({ content: '❌ No longer in progress.' });
    await endTournament(interaction.guild, fresh);
    await interaction.editReply({ content: '✅ Tournament **ended**!' });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseLock(lockKey); }
}

async function executeDelete(interaction, tournament) {
  const lockKey = `tournament_delete_${tournament.id}`;
  if (!acquireLock(lockKey)) return interaction.update({ content: '⏳ Already deleting.', embeds: [], components: [] });

  await interaction.update({ content: '⏳ Deleting…', embeds: [], components: [] });
  try {
    await deleteTournamentInfrastructure(interaction.guild, tournament);
    try { await interaction.editReply({ content: '✅ **Deleted**.' }); } catch {}
  } catch (err) {
    try { await interaction.editReply({ content: `❌ Failed: ${err.message}` }); } catch {}
  } finally { releaseLock(lockKey); }
}

// ═════════════════════════════════════════════════════════════════
//  REGISTRATION BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleRegButton(interaction, action, tournamentId) {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });

  let member;
  try { member = await interaction.guild.members.fetch(interaction.user.id); }
  catch { return interaction.reply({ content: '❌ Could not fetch profile.', flags: MessageFlags.Ephemeral }); }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  switch (action) {
    case 'register':   result = await registerParticipant(interaction.guild, tournament, interaction.user, member); break;
    case 'unregister': result = await unregisterParticipant(interaction.guild, tournament, interaction.user, member); break;
    case 'spectate':   result = await registerSpectator(interaction.guild, tournament, interaction.user, member); break;
    default: return interaction.editReply({ content: '❓ Unknown.' });
  }
  await interaction.editReply({ content: result.message });
}

// ═════════════════════════════════════════════════════════════════
//  MATCH BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleMatchButton(interaction, action, targetId) {
  switch (action) {
    case 'score': return showScoreModal(interaction, targetId);
    case 'dq':    return showDqPlayerSelect(interaction, targetId);
    case 'dqp':   return executeDqFromMatch(interaction, targetId);
    default: await interaction.reply({ content: '❓ Unknown.', flags: MessageFlags.Ephemeral });
  }
}

async function showScoreModal(interaction, matchId) {
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const id = parseInt(matchId, 10);
  const match = await getMatchById(id);
  if (!match) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });
  if (match.status === 'completed') return interaction.reply({ content: '❌ Already completed.', flags: MessageFlags.Ephemeral });
  if (match.status === 'cancelled') return interaction.reply({ content: '❌ Cancelled.', flags: MessageFlags.Ephemeral });
  if (isLocked(`match_${id}`)) return interaction.reply({ content: '⏳ Another staff is scoring.', flags: MessageFlags.Ephemeral });

  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });

  const p1Data = await getParticipant(tournament.id, match.player1_id);
  const p2Data = await getParticipant(tournament.id, match.player2_id);
  const p1Name = p1Data?.display_name || p1Data?.username || 'P1';
  const p2Name = p2Data?.display_name || p2Data?.username || 'P2';

  const max = 15;
  const s1 = p1Name.length > max ? p1Name.substring(0, max - 1) + '…' : p1Name;
  const s2 = p2Name.length > max ? p2Name.substring(0, max - 1) + '…' : p2Name;
  const label = `1 = ${s1}, 2 = ${s2}`;
  const safeLabel = label.length > 45 ? 'Enter 1 or 2 for the winner' : label;

  const modal = new ModalBuilder().setCustomId(`modal_score_${match.id}`).setTitle('Record Game Result');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('winner').setLabel(safeLabel).setStyle(TextInputStyle.Short)
      .setPlaceholder(`1 for ${p1Name.substring(0, 30)} | 2 for ${p2Name.substring(0, 30)}`).setMinLength(1).setMaxLength(1).setRequired(true),
  ));
  await interaction.showModal(modal);
}

async function showDqPlayerSelect(interaction, matchId) {
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const match = await getMatchById(parseInt(matchId, 10));
  if (!match) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });
  if (match.status === 'completed' || match.status === 'cancelled') return interaction.reply({ content: '❌ Already finished.', flags: MessageFlags.Ephemeral });

  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });

  const p1Data = await getParticipant(tournament.id, match.player1_id);
  const p2Data = await getParticipant(tournament.id, match.player2_id);
  const p1Name = p1Data?.display_name || p1Data?.username || 'P1';
  const p2Name = p2Data?.display_name || p2Data?.username || 'P2';
  const p1Short = p1Name.length > 20 ? p1Name.substring(0, 19) + '…' : p1Name;
  const p2Short = p2Name.length > 20 ? p2Name.substring(0, 19) + '…' : p2Name;

  const embed = new EmbedBuilder().setTitle('⛔ Disqualify Player').setColor(COLORS.DANGER)
    .setDescription(`**Player 1:** ${p1Name} (<@${match.player1_id}>)\n**Player 2:** ${p2Name} (<@${match.player2_id}>)\n\n⚠️ This cannot be undone!`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match_dqp_${match.id}:${match.player1_id}`).setLabel(`DQ ${p1Short}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`match_dqp_${match.id}:${match.player2_id}`).setLabel(`DQ ${p2Short}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`confirm_no_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function executeDqFromMatch(interaction, encodedId) {
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const [matchIdStr, targetUserId] = encodedId.split(':');
  if (!targetUserId) return interaction.reply({ content: '❌ Invalid target.', flags: MessageFlags.Ephemeral });

  const match = await getMatchById(parseInt(matchIdStr, 10));
  if (!match) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });

  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });

  const targetData = await getParticipant(tournament.id, targetUserId);
  const targetName = targetData?.display_name || targetData?.username || 'Unknown';
  const shortName = targetName.length > 30 ? targetName.substring(0, 29) + '…' : targetName;

  const modal = new ModalBuilder().setCustomId(`modal_dq_${match.id}:${targetUserId}`).setTitle(`DQ ${shortName}`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. Cheating, inactivity…').setMaxLength(200).setRequired(true),
  ));
  await interaction.showModal(modal);
}

// ═════════════════════════════════════════════════════════════════
//  HELP BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleHelpButton(interaction, category) {
  const builder = EMBED_BUILDERS[category];
  if (!builder) return interaction.reply({ content: '❓ Unknown.', flags: MessageFlags.Ephemeral });
  await interaction.update({ embeds: [builder()], components: buildHelpButtons(category) });
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleGiveawayButton(interaction, action, targetId) {
  switch (action) {
    case 'approve': return handleGiveawayApprove(interaction, targetId);
    case 'reject':  return handleGiveawayReject(interaction, targetId);
    case 'enter':   return handleGiveawayEnter(interaction, targetId);
    case 'channel': return handleGiveawayChannelSelect(interaction, targetId);
    default: await interaction.reply({ content: '❓ Unknown.', flags: MessageFlags.Ephemeral });
  }
}

async function handleGiveawayApprove(interaction, giveawayId) {
  const id = parseInt(giveawayId, 10);
  const giveaway = await getGiveawayById(id);

  if (!giveaway) return interaction.update({ content: '❌ Not found.', embeds: [], components: [] });
  if (giveaway.status !== 'pending') {
    const msg = giveaway.status === 'approved' ? '✅ Already **approved**.' : '❌ Already **rejected**.';
    return interaction.update({ content: msg, embeds: [], components: [buildDisabledReviewButtons(id, giveaway.status === 'approved' ? 'approved' : 'rejected')] });
  }

  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return interaction.reply({ content: '❌ Server not found.', flags: MessageFlags.Ephemeral });

  const config = await getGiveawayConfig(giveaway.guild_id);
  if (!config) return interaction.reply({ content: '❌ Not configured.', flags: MessageFlags.Ephemeral });

  try {
    const member = await guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.staff_role_id) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Staff only.', flags: MessageFlags.Ephemeral });
    }
  } catch { return interaction.reply({ content: '❌ Cannot verify permissions.', flags: MessageFlags.Ephemeral }); }

  const allChannels = await getGiveawayChannels(giveaway.guild_id);

  // Auto-cleanup deleted channels
  const validChannels = [];
  for (const ch of allChannels) {
    const resolved = guild.channels.cache.get(ch.channel_id);
    if (resolved) {
      validChannels.push(ch);
    } else {
      await removeGiveawayChannel(giveaway.guild_id, ch.channel_id);
      console.log(`[GIVEAWAY] Auto-cleaned deleted channel: ${ch.channel_id}`);
    }
  }

  if (validChannels.length === 0) {
    return interaction.reply({ content: '❌ No valid giveaway channels. All were deleted. Ask admin to add new ones.', flags: MessageFlags.Ephemeral });
  }

  const rows = [];
  const row = new ActionRowBuilder();
  for (let i = 0; i < validChannels.length && i < 5; i++) {
    const ch = guild.channels.cache.get(validChannels[i].channel_id);
    const label = ch ? `#${ch.name}` : 'Unknown';
    row.addComponents(new ButtonBuilder().setCustomId(`ga_channel_${giveawayId}:${validChannels[i].channel_id}`).setLabel(label.substring(0, 40)).setEmoji('📢').setStyle(ButtonStyle.Primary));
  }
  rows.push(row);

  if (validChannels.length > 5) {
    const row2 = new ActionRowBuilder();
    for (let i = 5; i < validChannels.length && i < 10; i++) {
      const ch = guild.channels.cache.get(validChannels[i].channel_id);
      row2.addComponents(new ButtonBuilder().setCustomId(`ga_channel_${giveawayId}:${validChannels[i].channel_id}`).setLabel((ch ? `#${ch.name}` : 'Unknown').substring(0, 40)).setEmoji('📢').setStyle(ButtonStyle.Primary));
    }
    rows.push(row2);
  }

  await interaction.update({ content: `📢 Select channel for giveaway **#${giveawayId}**:`, embeds: [], components: rows });
}

async function handleGiveawayChannelSelect(interaction, encodedId) {
  const [giveawayIdStr, channelId] = encodedId.split(':');
  const giveawayId = parseInt(giveawayIdStr, 10);

  const giveaway = await getGiveawayById(giveawayId);
  if (!giveaway) return interaction.update({ content: '❌ Not found.', components: [] });
  if (giveaway.status !== 'pending') return interaction.update({ content: '⚠️ Already processed.', components: [] });
  if (!acquireGiveawayLock(giveawayId)) return interaction.update({ content: '⏳ Being processed.', components: [] });

  await interaction.update({ content: '⏳ Publishing…', components: [] });

  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) { releaseGiveawayLock(giveawayId); return interaction.editReply({ content: '❌ Server not found.' }); }

  try {
    const freshGiveaway = await getGiveawayById(giveawayId);
    if (freshGiveaway.status !== 'pending') return interaction.editReply({ content: '⚠️ Already processed.' });

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return interaction.editReply({ content: '❌ Channel not found.' });

    const endsAt = new Date(Date.now() + giveaway.duration_minutes * 60 * 1000).toISOString();
    const config = await getGiveawayConfig(giveaway.guild_id);
    const pingContent = config?.ping_role_id ? `<@&${config.ping_role_id}>` : '@everyone';

    const embed = buildGiveawayEmbed({ ...giveaway, ends_at: endsAt }, 0, false);
    const buttons = buildGiveawayButtons(giveaway.id, false);

    const giveawayMsg = await channel.send({
      content: pingContent, embeds: [embed], components: [buttons],
      allowedMentions: { parse: ['everyone'], roles: config?.ping_role_id ? [config.ping_role_id] : [] },
    });

    await updateGiveawayApproval(giveaway.id, { channelId: channel.id, messageId: giveawayMsg.id, endsAt });

    try {
      const creator = await guild.members.fetch(giveaway.creator_id).catch(() => null);
      if (creator) {
        const epoch = Math.floor(new Date(endsAt).getTime() / 1000);
        await creator.send({ embeds: [new EmbedBuilder().setTitle('✅ Giveaway Approved!').setColor(COLORS.SUCCESS).setDescription(`**${giveaway.prize}** published!\n📢 <#${channel.id}>\n⏰ Ends <t:${epoch}:R>\n✅ By: ${interaction.user.displayName}`).setFooter({ text: guild.name }).setTimestamp()] });
      }
    } catch {}

    const pingLabel = config?.ping_role_id ? `<@&${config.ping_role_id}>` : '@everyone';
    await interaction.editReply({ content: `✅ Giveaway **#${giveaway.id}** published in <#${channel.id}> with ${pingLabel}!` });
  } catch (err) {
    console.error('[GIVEAWAY]', err);
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseGiveawayLock(giveawayId); }
}

async function handleGiveawayReject(interaction, giveawayId) {
  const id = parseInt(giveawayId, 10);
  const giveaway = await getGiveawayById(id);

  if (!giveaway) return interaction.update({ content: '❌ Not found.', embeds: [], components: [] });
  if (giveaway.status !== 'pending') {
    const msg = giveaway.status === 'approved' ? '✅ Already **approved**.' : '❌ Already **rejected**.';
    return interaction.update({ content: msg, embeds: [], components: [buildDisabledReviewButtons(id, giveaway.status === 'approved' ? 'approved' : 'rejected')] });
  }

  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return interaction.reply({ content: '❌ Server not found.', flags: MessageFlags.Ephemeral });

  const config = await getGiveawayConfig(giveaway.guild_id);
  if (!config) return interaction.reply({ content: '❌ Not configured.', flags: MessageFlags.Ephemeral });

  try {
    const member = await guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.staff_role_id) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Staff only.', flags: MessageFlags.Ephemeral });
    }
  } catch { return interaction.reply({ content: '❌ Cannot verify.', flags: MessageFlags.Ephemeral }); }

  const modal = new ModalBuilder().setCustomId(`modal_gareject_${giveawayId}`).setTitle('Reject Giveaway');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Why reject?').setMaxLength(300).setRequired(true),
  ));
  await interaction.showModal(modal);
}

async function handleGiveawayEnter(interaction, giveawayId) {
  const id = parseInt(giveawayId, 10);
  const giveaway = await getGiveawayById(id);

  if (!giveaway) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });
  if (giveaway.status !== 'approved') return interaction.reply({ content: '❌ Giveaway ended.', flags: MessageFlags.Ephemeral });
  if (giveaway.ends_at && new Date(giveaway.ends_at) <= new Date()) return interaction.reply({ content: '❌ Expired.', flags: MessageFlags.Ephemeral });
  if (giveaway.creator_id === interaction.user.id) return interaction.reply({ content: '❌ Cannot enter your own!', flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const alreadyEntered = await hasEnteredGiveaway(id, userId);

  if (alreadyEntered) {
    await removeGiveawayEntry(id, userId);
    const newCount = await getGiveawayEntryCount(id);
    await updateGiveawayEmbedMessage(interaction, giveaway, newCount);
    return interaction.reply({ content: `❌ You **left** the giveaway for **${giveaway.prize}**.`, flags: MessageFlags.Ephemeral });
  }

  await addGiveawayEntry(id, userId);
  const newCount = await getGiveawayEntryCount(id);
  await updateGiveawayEmbedMessage(interaction, giveaway, newCount);

  const epoch = giveaway.ends_at ? Math.floor(new Date(giveaway.ends_at).getTime() / 1000) : null;
  const timeText = epoch ? `\n⏰ Ends <t:${epoch}:R>` : '';

  return interaction.reply({
    content: `✅ You **entered** the giveaway for **${giveaway.prize}**! 🎉\n🎫 Entries: **${newCount}**${timeText}\n\n_Click again to leave._`,
    flags: MessageFlags.Ephemeral,
  });
}

async function updateGiveawayEmbedMessage(interaction, giveaway, entryCount) {
  try {
    const msg = interaction.message;
    if (!msg) return;
    const embed = buildGiveawayEmbed(giveaway, entryCount, false);
    const buttons = buildGiveawayButtons(giveaway.id, false);
    await msg.edit({ embeds: [embed], components: [buttons] });
  } catch (err) { console.warn('[GIVEAWAY] Could not update count:', err.message); }
}
