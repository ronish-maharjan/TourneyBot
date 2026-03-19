// ─── src/services/tournamentService.js ───────────────────────────

import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import {
  CHANNEL_NAMES,
  ROLE_NAMES,
  COLORS,
  TOURNAMENT_STATUS,
} from '../config.js';
import {
  createTournament as dbCreateTournament,
  getTournamentById,
  getActiveParticipantCount,
  getParticipantCount,
  getActiveParticipants,
  getParticipantsByTournament,
  getSpectators,
  getLeaderboard,
  getCompletedMatchCount,
  getTotalMatchCount,
  getMatchesByTournament,
  getAvailableMatchesForRound,
  getRemainingMatchCountForRound,
  updateTournamentChannels,
  updateTournamentRoles,
  updateTournamentMessageId,
  updateTournamentStatus,
  updateTournamentRound,
  deleteTournament,
  createMatchesBulk,
  cancelAllPendingMatches,
} from '../database/queries.js';
import { generateRoundRobinSchedule } from './matchService.js';
import { createMatchThreads } from './threadService.js';
import { generateLeaderboardImage } from '../canvas/leaderboard.js';
import { generateBracketImage } from '../canvas/bracket.js';
import { generateId, formatStatus, safeFetchMessage, safePin } from '../utils/helpers.js';

const BOT_CHANNEL_PERMS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles, PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageMessages,
];

function buildAdminPerms({ guildId, botId, organizerRoleId }) {
  return [
    { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: organizerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

function buildChatPerms({ guildId, botId, participantRoleId }) {
  return [
    { id: guildId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] },
    { id: participantRoleId, allow: [PermissionFlagsBits.SendMessages] },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

function buildMatchPerms({ guildId, botId, participantRoleId, spectatorRoleId }) {
  return [
    { id: guildId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] },
    { id: participantRoleId, allow: [PermissionFlagsBits.SendMessagesInThreads] },
    { id: spectatorRoleId, allow: [PermissionFlagsBits.SendMessagesInThreads] },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═════════════════════════════════════════════════════════════════

export async function buildAdminPanel(tournament) {
  const status = tournament.status;
  const id     = tournament.id;
  const safeName = tournament.name.length > 40 ? tournament.name.substring(0, 39) + '…' : tournament.name;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Admin Panel — ${safeName}`)
    .setColor(COLORS.PRIMARY)
    .addFields(
      { name: 'Status',      value: formatStatus(status),                        inline: true },
      { name: 'Format',      value: 'Round Robin',                               inline: true },
      { name: 'Best Of',     value: `${tournament.best_of}`,                     inline: true },
      { name: 'Team Size',   value: tournament.team_size === 1 ? 'Solo' : 'Duo', inline: true },
      { name: 'Max Players', value: `${tournament.max_players}`,                 inline: true },
      { name: 'ID',          value: `\`${id}\``,                                 inline: true },
    );

  if (tournament.rules?.trim()) embed.addFields({ name: '📜 Rules', value: tournament.rules.substring(0, 1024) });

  if (status !== TOURNAMENT_STATUS.CREATED) {
    const registered = await getParticipantCount(id);
    const active     = await getActiveParticipantCount(id);
    embed.addFields({ name: '👥 Players', value: `${active} active / ${registered} registered / ${tournament.max_players} max`, inline: false });
  }

  if (status === TOURNAMENT_STATUS.IN_PROGRESS || status === TOURNAMENT_STATUS.COMPLETED) {
    const completed = await getCompletedMatchCount(id);
    const total     = await getTotalMatchCount(id);
    embed.addFields({ name: '⚔️ Matches', value: `${completed} / ${total} completed`, inline: true });
    if (tournament.total_rounds > 0) embed.addFields({ name: '🔄 Rounds', value: `${tournament.current_round} / ${tournament.total_rounds}`, inline: true });
  }

  embed.setFooter({ text: 'Use the buttons below to manage the tournament' }).setTimestamp();

  const isEditable = ![TOURNAMENT_STATUS.IN_PROGRESS, TOURNAMENT_STATUS.COMPLETED, TOURNAMENT_STATUS.CANCELLED].includes(status);

  const configureBtn = new ButtonBuilder().setCustomId(`admin_configure_${id}`).setLabel('Configure').setEmoji('⚙️').setStyle(ButtonStyle.Secondary).setDisabled(!isEditable);

  let regBtn;
  if (status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    regBtn = new ButtonBuilder().setCustomId(`admin_closereg_${id}`).setLabel('Close Registration').setEmoji('🔒').setStyle(ButtonStyle.Danger);
  } else {
    regBtn = new ButtonBuilder().setCustomId(`admin_openreg_${id}`).setLabel('Open Registration').setEmoji('📝').setStyle(ButtonStyle.Success).setDisabled(!isEditable);
  }

  const startBtn  = new ButtonBuilder().setCustomId(`admin_start_${id}`).setLabel('Start Tournament').setEmoji('🚀').setStyle(ButtonStyle.Primary).setDisabled(status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED);
  const endBtn    = new ButtonBuilder().setCustomId(`admin_end_${id}`).setLabel('End Early').setEmoji('🏁').setStyle(ButtonStyle.Primary).setDisabled(status !== TOURNAMENT_STATUS.IN_PROGRESS);
  const deleteBtn = new ButtonBuilder().setCustomId(`admin_delete_${id}`).setLabel('Delete Tournament').setEmoji('🗑️').setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(configureBtn, regBtn, startBtn);
  const row2 = new ActionRowBuilder().addComponents(endBtn, deleteBtn);

  return { embeds: [embed], components: [row1, row2] };
}

// ═════════════════════════════════════════════════════════════════
//  REFRESH FUNCTIONS
// ═════════════════════════════════════════════════════════════════

export async function refreshAdminPanel(guild, tournament) {
  if (!tournament.admin_channel_id || !tournament.admin_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.admin_channel_id, tournament.admin_message_id);
    if (!result) return;
    const fresh = await getTournamentById(tournament.id);
    if (!fresh) return;
    const panel = await buildAdminPanel(fresh);
    if (result.message) {
      await result.message.edit(panel);
    } else {
      const newMsg = await result.channel.send(panel);
      await updateTournamentMessageId(tournament.id, 'admin_message_id', newMsg.id);
      await safePin(newMsg);
    }
  } catch (err) { console.warn('[ADMIN] Refresh failed:', err.message); }
}

export async function refreshRegistrationMessage(guild, tournament) {
  if (!tournament.registration_channel_id || !tournament.registration_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.registration_channel_id, tournament.registration_message_id);
    if (!result) return;
    const isOpen   = tournament.status === TOURNAMENT_STATUS.REGISTRATION_OPEN;
    const safeName = tournament.name.length > 30 ? tournament.name.substring(0, 29) + '…' : tournament.name;
    let payload;

    if (isOpen) {
      const count = await getParticipantCount(tournament.id);
      const embed = new EmbedBuilder().setTitle(`📋 Registration — ${safeName}`).setColor(COLORS.SUCCESS)
        .setDescription('Click a button below to register, unregister, or become a spectator!')
        .addFields(
          { name: 'Status', value: '📝 Open', inline: true }, { name: 'Players', value: `${count} / ${tournament.max_players}`, inline: true },
          { name: 'Team Size', value: tournament.team_size === 1 ? 'Solo' : 'Duo', inline: true },
          { name: 'Format', value: 'Round Robin', inline: true }, { name: 'Best Of', value: `${tournament.best_of}`, inline: true },
        ).setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reg_register_${tournament.id}`).setLabel('Register').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reg_unregister_${tournament.id}`).setLabel('Unregister').setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`reg_spectate_${tournament.id}`).setLabel('Spectate').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      );
      payload = { embeds: [embed], components: [row] };
    } else {
      const count = await getParticipantCount(tournament.id);
      const embed = new EmbedBuilder().setTitle(`📋 Registration — ${safeName}`).setColor(COLORS.DANGER)
        .setDescription('Registration is now **closed**.')
        .addFields({ name: 'Registered Players', value: `${count}`, inline: true }).setTimestamp();
      payload = { embeds: [embed], components: [] };
    }

    if (result.message) { await result.message.edit(payload); }
    else { const newMsg = await result.channel.send(payload); await updateTournamentMessageId(tournament.id, 'registration_message_id', newMsg.id); await safePin(newMsg); }
  } catch (err) { console.warn('[REG] Refresh failed:', err.message); }
}

export async function refreshParticipationList(guild, tournament) {
  if (!tournament.participation_channel_id || !tournament.participation_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.participation_channel_id, tournament.participation_message_id);
    if (!result) return;
    const participants = await getActiveParticipants(tournament.id);
    const spectators   = await getSpectators(tournament.id);
    const safeName = tournament.name.length > 30 ? tournament.name.substring(0, 29) + '…' : tournament.name;
    const embed = new EmbedBuilder().setTitle(`👥 Participants — ${safeName}`).setColor(COLORS.INFO).setTimestamp();

    if (participants.length === 0) { embed.setDescription('No participants registered yet.'); }
    else {
      const list = participants.map((p, i) => `**${i + 1}.** <@${p.user_id}> (${p.username})`).join('\n');
      embed.addFields({ name: `Participants (${participants.length}/${tournament.max_players})`, value: list.substring(0, 1024) });
    }
    if (spectators.length > 0) {
      embed.addFields({ name: `Spectators (${spectators.length})`, value: spectators.map(s => `<@${s.user_id}>`).join(', ').substring(0, 1024) });
    }

    if (result.message) { await result.message.edit({ embeds: [embed] }); }
    else { const newMsg = await result.channel.send({ embeds: [embed] }); await updateTournamentMessageId(tournament.id, 'participation_message_id', newMsg.id); await safePin(newMsg); }
  } catch (err) { console.warn('[PARTICIPATION] Refresh failed:', err.message); }
}

export async function sendTournamentNotice(guild, tournament, embed, pingEveryone = false) {
  if (!tournament.notice_channel_id) return;
  try {
    const channel = await guild.channels.fetch(tournament.notice_channel_id);
    if (!channel) return;
    const options = { embeds: [embed] };
    if (pingEveryone) { options.content = '@everyone'; options.allowedMentions = { parse: ['everyone'] }; }
    await channel.send(options);
  } catch (err) { console.warn('[NOTICE] Failed:', err.message); }
}

export function buildRulesEmbed(tournamentName, rules) {
  const safeName = tournamentName.length > 30 ? tournamentName.substring(0, 29) + '…' : tournamentName;
  const embed = new EmbedBuilder().setTitle(`📜 Rules — ${safeName}`).setColor(COLORS.INFO).setTimestamp();
  if (rules?.trim()) { embed.setDescription(rules); }
  else { embed.setDescription('📭 **No rules set yet.**\n\n_Use the Configure button in admin panel._'); }
  embed.setFooter({ text: 'Rules set by the tournament organiser' });
  return embed;
}

export async function refreshRules(guild, tournament) {
  if (!tournament.rules_channel_id || !tournament.rules_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.rules_channel_id, tournament.rules_message_id);
    if (!result) return;
    const embed = buildRulesEmbed(tournament.name, tournament.rules);
    if (result.message) { await result.message.edit({ embeds: [embed] }); }
    else { const newMsg = await result.channel.send({ embeds: [embed] }); await updateTournamentMessageId(tournament.id, 'rules_message_id', newMsg.id); await safePin(newMsg); }
  } catch (err) { console.warn('[RULES] Refresh failed:', err.message); }
}

export async function refreshLeaderboard(guild, tournament) {
  if (!tournament.leaderboard_channel_id || !tournament.leaderboard_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.leaderboard_channel_id, tournament.leaderboard_message_id);
    if (!result) return;
    const leaderboard = await getLeaderboard(tournament.id);
    const completed   = await getCompletedMatchCount(tournament.id);
    const total       = await getTotalMatchCount(tournament.id);
    const buffer      = generateLeaderboardImage(tournament, leaderboard, completed, total);
    const attachment  = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
    const payload     = { content: '', embeds: [], files: [attachment], attachments: [] };
    if (result.message) { await result.message.edit(payload); }
    else { const newMsg = await result.channel.send(payload); await updateTournamentMessageId(tournament.id, 'leaderboard_message_id', newMsg.id); await safePin(newMsg); }
  } catch (err) { console.error('[LEADERBOARD] Refresh failed:', err.message); }
}

export async function refreshBracket(guild, tournament) {
  if (!tournament.bracket_channel_id || !tournament.bracket_message_id) return;
  try {
    const result = await safeFetchMessage(guild, tournament.bracket_channel_id, tournament.bracket_message_id);
    if (!result) return;
    const allMatches = await getMatchesByTournament(tournament.id);
    const matchesByRound = {};
    for (const m of allMatches) { if (!matchesByRound[m.round]) matchesByRound[m.round] = []; matchesByRound[m.round].push(m); }
    const participants   = await getParticipantsByTournament(tournament.id);
    const participantMap = new Map();
    for (const p of participants) { participantMap.set(p.user_id, { display_name: p.display_name, username: p.username }); }
    const buffer     = generateBracketImage(tournament, matchesByRound, participantMap);
    const attachment = new AttachmentBuilder(buffer, { name: 'bracket.png' });
    const payload    = { content: '', embeds: [], files: [attachment], attachments: [] };
    if (result.message) { await result.message.edit(payload); }
    else { const newMsg = await result.channel.send(payload); await updateTournamentMessageId(tournament.id, 'bracket_message_id', newMsg.id); await safePin(newMsg); }
  } catch (err) { console.error('[BRACKET] Refresh failed:', err.message); }
}

// ═════════════════════════════════════════════════════════════════
//  OPEN / CLOSE REGISTRATION
// ═════════════════════════════════════════════════════════════════

export async function openRegistration(guild, tournament) {
  await updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.REGISTRATION_OPEN);
  const fresh = await getTournamentById(tournament.id);
  await refreshRegistrationMessage(guild, fresh);
  await refreshAdminPanel(guild, fresh);
  await sendTournamentNotice(guild, fresh, new EmbedBuilder().setTitle('📝 Registration Open!').setDescription(`Registration for **${fresh.name}** is now open!\nHead to <#${fresh.registration_channel_id}> to sign up.`).setColor(COLORS.SUCCESS).setTimestamp(), true);
}

export async function closeRegistration(guild, tournament) {
  await updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.REGISTRATION_CLOSED);
  const fresh = await getTournamentById(tournament.id);
  await refreshRegistrationMessage(guild, fresh);
  await refreshAdminPanel(guild, fresh);
  await sendTournamentNotice(guild, fresh, new EmbedBuilder().setTitle('🔒 Registration Closed').setDescription(`Registration for **${fresh.name}** is now closed.`).setColor(COLORS.WARNING).setTimestamp(), true);
}

// ═════════════════════════════════════════════════════════════════
//  START TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function startTournament(guild, tournament) {
  const participants = await getActiveParticipants(tournament.id);
  if (participants.length < 2) throw new Error('At least **2 active participants** required.');

  const playerIds = participants.map(p => p.user_id);
  const { totalRounds, matches } = generateRoundRobinSchedule(playerIds);
  const matchRows = matches.map(m => ({ tournamentId: tournament.id, round: m.round, matchNumber: m.matchNumber, player1Id: m.player1Id, player2Id: m.player2Id }));
  await createMatchesBulk(matchRows);

  await updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.IN_PROGRESS);
  await updateTournamentRound(tournament.id, 1, totalRounds);

  const fresh = await getTournamentById(tournament.id);
  await refreshAdminPanel(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  await sendTournamentNotice(guild, fresh, new EmbedBuilder().setTitle('🚀 Tournament Started!')
    .setDescription(`**${fresh.name}** has begun!\n\n👥 **${participants.length}** participants\n⚔️ **${matches.length}** matches across **${totalRounds}** round(s)\n📋 Format: Round Robin · Best of ${fresh.best_of}`)
    .setColor(COLORS.SUCCESS).setTimestamp(), true);

  await refreshLeaderboard(guild, fresh);
  await launchAvailableMatches(guild, fresh);

  const freshAfterLaunch = await getTournamentById(tournament.id);
  await refreshBracket(guild, freshAfterLaunch);
  return freshAfterLaunch;
}

// ═════════════════════════════════════════════════════════════════
//  LAUNCH AVAILABLE MATCHES
// ═════════════════════════════════════════════════════════════════

export async function launchAvailableMatches(guild, tournament) {
  const fresh = await getTournamentById(tournament.id);
  const currentRound = fresh.current_round;
  if (currentRound <= 0) return 0;

  const available = await getAvailableMatchesForRound(tournament.id, currentRound);
  if (available.length === 0) {
    const remaining = await getRemainingMatchCountForRound(tournament.id, currentRound);
    if (remaining > 0) console.log(`[MATCH] Round ${currentRound}: ${remaining} in progress, waiting…`);
    return 0;
  }

  const busyPlayers = new Set();
  const toCreate    = [];
  for (const match of available) {
    if (!busyPlayers.has(match.player1_id) && !busyPlayers.has(match.player2_id)) {
      toCreate.push(match);
      busyPlayers.add(match.player1_id);
      busyPlayers.add(match.player2_id);
    }
  }
  if (toCreate.length === 0) return 0;

  console.log(`[MATCH] Launching ${toCreate.length} thread(s) for Round ${currentRound}`);
  return await createMatchThreads(guild, fresh, toCreate);
}

// ═════════════════════════════════════════════════════════════════
//  END TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function endTournament(guild, tournament) {
  await cancelAllPendingMatches(tournament.id);
  await updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh       = await getTournamentById(tournament.id);
  const leaderboard = await getLeaderboard(tournament.id);
  const completed   = await getCompletedMatchCount(tournament.id);
  const total       = await getTotalMatchCount(tournament.id);

  await refreshLeaderboard(guild, fresh);
  await refreshBracket(guild, fresh);

  const resultsEmbed = new EmbedBuilder().setTitle(`🏁 Tournament Complete — ${fresh.name}`).setColor(COLORS.SUCCESS).setTimestamp();

  if (leaderboard.length === 0 || completed === 0) {
    resultsEmbed.setDescription('Tournament ended with no completed matches.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    let desc = '**Final Standings:**\n\n';
    for (let i = 0; i < Math.min(leaderboard.length, 10); i++) {
      const p = leaderboard[i];
      const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
      const dq = p.status === 'disqualified' ? ' *(DQ)*' : '';
      desc += `${prefix} <@${p.user_id}>${dq} — ${p.points} pts (${p.wins}W / ${p.losses}L / ${p.draws}D)\n`;
    }
    resultsEmbed.setDescription(desc);
    resultsEmbed.addFields({ name: 'Matches Played', value: `${completed} / ${total}`, inline: true });
    if (leaderboard.length > 0) resultsEmbed.addFields({ name: '🏆 Winner', value: `<@${leaderboard[0].user_id}> with **${leaderboard[0].points}** points!` });
  }

  await refreshAdminPanel(guild, fresh);
  await sendTournamentNotice(guild, fresh, resultsEmbed, true);

  const participants = await getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank = leaderboard.findIndex(l => l.user_id === p.user_id) + 1;
    const medal = rank > 0 && rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : '';
    try {
      const member = await guild.members.fetch(p.user_id).catch(() => null);
      if (member) await member.send({ embeds: [new EmbedBuilder().setTitle(`${medal} Tournament Ended — ${fresh.name}`).setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO).setDescription(`**${fresh.name}** has ended!\n\n🏅 **Rank:** #${rank}\n⭐ **Points:** ${p.points}\n✅ ${p.wins}W · ❌ ${p.losses}L · 🤝 ${p.draws}D\n🎮 ${p.matches_played} played`).setFooter({ text: guild.name }).setTimestamp()] });
    } catch {}
  }

  return fresh;
}

// ═════════════════════════════════════════════════════════════════
//  DELETE TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function deleteTournamentInfrastructure(guild, tournament) {
  const reason = `Tournament deleted: ${tournament.name}`;
  const channelIds = [tournament.leaderboard_channel_id, tournament.admin_channel_id, tournament.notice_channel_id, tournament.rules_channel_id, tournament.registration_channel_id, tournament.participation_channel_id, tournament.bracket_channel_id, tournament.result_channel_id, tournament.chat_channel_id, tournament.match_channel_id].filter(Boolean);

  for (const chId of channelIds) { try { const ch = await guild.channels.fetch(chId).catch(() => null); if (ch) await ch.delete(reason); } catch {} }
  if (tournament.category_id) { try { const cat = await guild.channels.fetch(tournament.category_id).catch(() => null); if (cat) await cat.delete(reason); } catch {} }

  for (const roleId of [tournament.participant_role_id, tournament.spectator_role_id].filter(Boolean)) {
    try { const role = await guild.roles.fetch(roleId).catch(() => null); if (role) await role.delete(reason); } catch {}
  }

  await deleteTournament(tournament.id);
  console.log(`[TOURNAMENT] Deleted "${tournament.name}"`);
}

// ═════════════════════════════════════════════════════════════════
//  ORGANISER ROLE
// ═════════════════════════════════════════════════════════════════

export async function getOrCreateOrganizerRole(guild) {
  let role = guild.roles.cache.find(r => r.name === ROLE_NAMES.ORGANIZER);
  if (!role) {
    role = await guild.roles.create({ name: ROLE_NAMES.ORGANIZER, color: 0x5865F2, mentionable: false, reason: 'Tournament Bot — Organizer role' });
  }
  return role;
}

// ═════════════════════════════════════════════════════════════════
//  MAIN CREATION FLOW
// ═════════════════════════════════════════════════════════════════

export async function createTournamentInfrastructure(guild, botUser, tournamentName, createdBy) {
  const tournamentId = generateId();
  const reason       = `Tournament: ${tournamentName}`;
  const createdRoles = [];
  const createdChannels = {};
  let category = null;

  try {
    await dbCreateTournament({ id: tournamentId, guildId: guild.id, name: tournamentName, createdBy });

    const organizerRole = await getOrCreateOrganizerRole(guild);
    try { const creator = await guild.members.fetch(createdBy); if (!creator.roles.cache.has(organizerRole.id)) await creator.roles.add(organizerRole, reason); } catch {}

    const participantRole = await guild.roles.create({ name: `${tournamentName} ${ROLE_NAMES.PARTICIPANT}`, color: 0x57F287, mentionable: false, reason });
    createdRoles.push(participantRole);
    const spectatorRole = await guild.roles.create({ name: `${tournamentName} ${ROLE_NAMES.SPECTATOR}`, color: 0xFEE75C, mentionable: false, reason });
    createdRoles.push(spectatorRole);

    category = await guild.channels.create({
      name: `🏆 ${tournamentName}`, type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] },
        { id: botUser.id, allow: BOT_CHANNEL_PERMS },
      ], reason,
    });

    const roleIds = { guildId: guild.id, botId: botUser.id, organizerRoleId: organizerRole.id, participantRoleId: participantRole.id, spectatorRoleId: spectatorRole.id };

    const channelDefs = [
      { key: 'leaderboard', name: CHANNEL_NAMES.LEADERBOARD, topic: 'Leaderboard' },
      { key: 'admin', name: CHANNEL_NAMES.ADMIN, topic: 'Admin panel', perms: buildAdminPerms(roleIds) },
      { key: 'notice', name: CHANNEL_NAMES.NOTICE, topic: 'Notices' },
      { key: 'rules', name: CHANNEL_NAMES.RULES, topic: 'Rules' },
      { key: 'registration', name: CHANNEL_NAMES.REGISTRATION, topic: 'Registration' },
      { key: 'participation', name: CHANNEL_NAMES.PARTICIPATION, topic: 'Participants' },
      { key: 'bracket', name: CHANNEL_NAMES.BRACKET, topic: 'Bracket' },
      { key: 'result', name: CHANNEL_NAMES.RESULT, topic: 'Results' },
      { key: 'chat', name: CHANNEL_NAMES.CHAT, topic: 'Chat', perms: buildChatPerms(roleIds) },
      { key: 'match', name: CHANNEL_NAMES.MATCH, topic: 'Matches', perms: buildMatchPerms(roleIds) },
    ];

    for (const def of channelDefs) {
      const opts = { name: def.name, type: ChannelType.GuildText, parent: category.id, topic: def.topic, reason };
      if (def.perms) opts.permissionOverwrites = def.perms;
      createdChannels[def.key] = await guild.channels.create(opts);
    }

    await updateTournamentChannels(tournamentId, {
      categoryId: category.id, leaderboardChannelId: createdChannels.leaderboard.id, adminChannelId: createdChannels.admin.id,
      noticeChannelId: createdChannels.notice.id, registrationChannelId: createdChannels.registration.id, participationChannelId: createdChannels.participation.id,
      bracketChannelId: createdChannels.bracket.id, resultChannelId: createdChannels.result.id, chatChannelId: createdChannels.chat.id,
      matchChannelId: createdChannels.match.id, rulesChannelId: createdChannels.rules.id,
    });

    await updateTournamentRoles(tournamentId, { organizerRoleId: organizerRole.id, participantRoleId: participantRole.id, spectatorRoleId: spectatorRole.id });

    // Send initial messages + pin
    const t = await getTournamentById(tournamentId);
    const adminMsg = await createdChannels.admin.send(await buildAdminPanel(t));
    await updateTournamentMessageId(tournamentId, 'admin_message_id', adminMsg.id); await safePin(adminMsg);

    const lbMsg = await createdChannels.leaderboard.send({ embeds: [new EmbedBuilder().setTitle('📊 Leaderboard').setDescription('Appears when tournament starts.').setColor(COLORS.NEUTRAL).setTimestamp()] });
    await updateTournamentMessageId(tournamentId, 'leaderboard_message_id', lbMsg.id); await safePin(lbMsg);

    const brMsg = await createdChannels.bracket.send({ embeds: [new EmbedBuilder().setTitle('🔀 Bracket').setDescription('Appears when tournament starts.').setColor(COLORS.NEUTRAL).setTimestamp()] });
    await updateTournamentMessageId(tournamentId, 'bracket_message_id', brMsg.id); await safePin(brMsg);

    const paMsg = await createdChannels.participation.send({ embeds: [new EmbedBuilder().setTitle('👥 Participants').setDescription('No participants yet.').setColor(COLORS.NEUTRAL).setTimestamp()] });
    await updateTournamentMessageId(tournamentId, 'participation_message_id', paMsg.id); await safePin(paMsg);

    const reMsg = await createdChannels.registration.send({ embeds: [new EmbedBuilder().setTitle('📋 Registration').setDescription('Not open yet.').setColor(COLORS.NEUTRAL).setTimestamp()] });
    await updateTournamentMessageId(tournamentId, 'registration_message_id', reMsg.id); await safePin(reMsg);

    const ruMsg = await createdChannels.rules.send({ embeds: [buildRulesEmbed(tournamentName, '')] });
    await updateTournamentMessageId(tournamentId, 'rules_message_id', ruMsg.id); await safePin(ruMsg);

    await createdChannels.notice.send({ embeds: [new EmbedBuilder().setTitle('📢 Notices').setDescription(`Welcome to **${tournamentName}**!`).setColor(COLORS.INFO).setTimestamp()] });
    await createdChannels.result.send({ embeds: [new EmbedBuilder().setTitle('📋 Results').setDescription('Results appear here.').setColor(COLORS.NEUTRAL).setTimestamp()] });
    await createdChannels.chat.send({ embeds: [new EmbedBuilder().setTitle('💬 Chat').setDescription('Participants and spectators can chat here.').setColor(COLORS.INFO).setTimestamp()] });
    await createdChannels.match.send({ embeds: [new EmbedBuilder().setTitle('⚔️ Matches').setDescription('Match threads appear here.').setColor(COLORS.NEUTRAL).setTimestamp()] });

    console.log(`[TOURNAMENT] Created "${tournamentName}" (${tournamentId})`);
    return await getTournamentById(tournamentId);

  } catch (error) {
    console.error('[TOURNAMENT] Creation failed:', error.message);
    for (const ch of Object.values(createdChannels)) { try { await ch.delete('Cleanup'); } catch {} }
    if (category) { try { await category.delete('Cleanup'); } catch {} }
    for (const role of createdRoles) { try { await role.delete('Cleanup'); } catch {} }
    try { await deleteTournament(tournamentId); } catch {}
    throw error;
  }
}
