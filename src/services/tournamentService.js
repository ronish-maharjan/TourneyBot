// ─── src/services/tournamentService.js ───────────────────────────
// Core service for tournament lifecycle: creation, config, registration,
// start, end, delete — and all the embed/message helpers.

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

// ── Bot permission set reused for every channel ──────────────────
const BOT_CHANNEL_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageMessages,
];

// ═════════════════════════════════════════════════════════════════
//  PERMISSION BUILDERS
// ═════════════════════════════════════════════════════════════════

function buildAdminPerms({ guildId, botId, organizerRoleId }) {
  return [
    { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: organizerRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

function buildChatPerms({ guildId, botId, participantRoleId }) {
  return [
    {
      id: guildId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
      ],
    },
    { id: participantRoleId, allow: [PermissionFlagsBits.SendMessages] },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

function buildMatchPerms({ guildId, botId, participantRoleId, spectatorRoleId }) {
  return [
    {
      id: guildId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
      ],
    },
    { id: participantRoleId, allow: [PermissionFlagsBits.SendMessagesInThreads] },
    { id: spectatorRoleId, allow: [PermissionFlagsBits.SendMessagesInThreads] },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═════════════════════════════════════════════════════════════════

export function buildAdminPanel(tournament) {
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

  if (tournament.rules && tournament.rules.trim()) {
    embed.addFields({ name: '📜 Rules', value: tournament.rules.substring(0, 1024) });
  }

  if (status !== TOURNAMENT_STATUS.CREATED) {
    const registered = getParticipantCount(id);
    const active     = getActiveParticipantCount(id);
    embed.addFields({
      name: '👥 Players',
      value: `${active} active / ${registered} registered / ${tournament.max_players} max`,
      inline: false,
    });
  }

  if (status === TOURNAMENT_STATUS.IN_PROGRESS || status === TOURNAMENT_STATUS.COMPLETED) {
    const completed = getCompletedMatchCount(id);
    const total     = getTotalMatchCount(id);
    embed.addFields(
      { name: '⚔️ Matches', value: `${completed} / ${total} completed`, inline: true },
    );
    if (tournament.total_rounds > 0) {
      embed.addFields(
        { name: '🔄 Rounds', value: `${tournament.current_round} / ${tournament.total_rounds}`, inline: true },
      );
    }
  }

  embed
    .setFooter({ text: 'Use the buttons below to manage the tournament' })
    .setTimestamp();

  // ── Buttons ──────────────────────────────────────────────────
  const isEditable = ![
    TOURNAMENT_STATUS.IN_PROGRESS,
    TOURNAMENT_STATUS.COMPLETED,
    TOURNAMENT_STATUS.CANCELLED,
  ].includes(status);

  const configureBtn = new ButtonBuilder()
    .setCustomId(`admin_configure_${id}`)
    .setLabel('Configure')
    .setEmoji('⚙️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!isEditable);

  let regBtn;
  if (status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    regBtn = new ButtonBuilder()
      .setCustomId(`admin_closereg_${id}`)
      .setLabel('Close Registration')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);
  } else {
    regBtn = new ButtonBuilder()
      .setCustomId(`admin_openreg_${id}`)
      .setLabel('Open Registration')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isEditable);
  }

  const startBtn = new ButtonBuilder()
    .setCustomId(`admin_start_${id}`)
    .setLabel('Start Tournament')
    .setEmoji('🚀')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED);

  const endBtn = new ButtonBuilder()
    .setCustomId(`admin_end_${id}`)
    .setLabel('End Early')
    .setEmoji('🏁')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(status !== TOURNAMENT_STATUS.IN_PROGRESS);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`admin_delete_${id}`)
    .setLabel('Delete Tournament')
    .setEmoji('🗑️')
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(configureBtn, regBtn, startBtn);
  const row2 = new ActionRowBuilder().addComponents(endBtn, deleteBtn);

  return { embeds: [embed], components: [row1, row2] };
}

// ═════════════════════════════════════════════════════════════════
//  REFRESH ADMIN PANEL
// ═════════════════════════════════════════════════════════════════

export async function refreshAdminPanel(guild, tournament) {
  if (!tournament.admin_channel_id || !tournament.admin_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.admin_channel_id, tournament.admin_message_id);
    if (!result) return;

    const fresh = getTournamentById(tournament.id);
    if (!fresh) return;

    const panel = buildAdminPanel(fresh);

    if (result.message) {
      await result.message.edit(panel);
    } else {
      const newMsg = await result.channel.send(panel);
      updateTournamentMessageId(tournament.id, 'admin_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[ADMIN] Admin panel message was deleted — recreated');
    }
  } catch (err) {
    console.warn('[ADMIN] Could not refresh admin panel:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  REGISTRATION MESSAGE
// ═════════════════════════════════════════════════════════════════

export async function refreshRegistrationMessage(guild, tournament) {
  if (!tournament.registration_channel_id || !tournament.registration_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.registration_channel_id, tournament.registration_message_id);
    if (!result) return;

    const isOpen = tournament.status === TOURNAMENT_STATUS.REGISTRATION_OPEN;
    const safeName = tournament.name.length > 30 ? tournament.name.substring(0, 29) + '…' : tournament.name;

    let payload;

    if (isOpen) {
      const count = getParticipantCount(tournament.id);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Registration — ${safeName}`)
        .setColor(COLORS.SUCCESS)
        .setDescription('Click a button below to register, unregister, or become a spectator!')
        .addFields(
          { name: 'Status',    value: '📝 Open',                                  inline: true },
          { name: 'Players',   value: `${count} / ${tournament.max_players}`,      inline: true },
          { name: 'Team Size', value: tournament.team_size === 1 ? 'Solo' : 'Duo', inline: true },
          { name: 'Format',    value: 'Round Robin',                                inline: true },
          { name: 'Best Of',   value: `${tournament.best_of}`,                      inline: true },
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reg_register_${tournament.id}`)
          .setLabel('Register')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reg_unregister_${tournament.id}`)
          .setLabel('Unregister')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`reg_spectate_${tournament.id}`)
          .setLabel('Spectate')
          .setEmoji('👁️')
          .setStyle(ButtonStyle.Secondary),
      );

      payload = { embeds: [embed], components: [row] };
    } else {
      const count = getParticipantCount(tournament.id);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Registration — ${safeName}`)
        .setColor(COLORS.DANGER)
        .setDescription('Registration is now **closed**.')
        .addFields({ name: 'Registered Players', value: `${count}`, inline: true })
        .setTimestamp();

      payload = { embeds: [embed], components: [] };
    }

    if (result.message) {
      await result.message.edit(payload);
    } else {
      const newMsg = await result.channel.send(payload);
      updateTournamentMessageId(tournament.id, 'registration_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[REG] Registration message was deleted — recreated');
    }
  } catch (err) {
    console.warn('[REG] Could not refresh registration message:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  PARTICIPATION LIST
// ═════════════════════════════════════════════════════════════════

export async function refreshParticipationList(guild, tournament) {
  if (!tournament.participation_channel_id || !tournament.participation_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.participation_channel_id, tournament.participation_message_id);
    if (!result) return;

    const participants = getActiveParticipants(tournament.id);
    const spectators   = getSpectators(tournament.id);

    const safeName = tournament.name.length > 30 ? tournament.name.substring(0, 29) + '…' : tournament.name;
    const embed = new EmbedBuilder()
      .setTitle(`👥 Participants — ${safeName}`)
      .setColor(COLORS.INFO)
      .setTimestamp();

    if (participants.length === 0) {
      embed.setDescription('No participants registered yet.');
    } else {
      const list = participants
        .map((p, i) => `**${i + 1}.** <@${p.user_id}> (${p.username})`)
        .join('\n');
      embed.addFields({
        name: `Participants (${participants.length}/${tournament.max_players})`,
        value: list.substring(0, 1024),
      });
    }

    if (spectators.length > 0) {
      const sList = spectators.map(s => `<@${s.user_id}>`).join(', ');
      embed.addFields({
        name: `Spectators (${spectators.length})`,
        value: sList.substring(0, 1024),
      });
    }

    if (result.message) {
      await result.message.edit({ embeds: [embed] });
    } else {
      const newMsg = await result.channel.send({ embeds: [embed] });
      updateTournamentMessageId(tournament.id, 'participation_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[PARTICIPATION] Message was deleted — recreated');
    }
  } catch (err) {
    console.warn('[PARTICIPATION] Could not refresh:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  NOTICE HELPER
// ═════════════════════════════════════════════════════════════════

export async function sendTournamentNotice(guild, tournament, embed, pingEveryone = false) {
  if (!tournament.notice_channel_id) return;
  try {
    const channel = await guild.channels.fetch(tournament.notice_channel_id);
    if (!channel) return;

    const options = { embeds: [embed] };

    if (pingEveryone) {
      options.content = '@everyone';
      options.allowedMentions = { parse: ['everyone'] };
    }

    await channel.send(options);
  } catch (err) {
    console.warn('[NOTICE] Could not send notice:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  RULES CHANNEL
// ═════════════════════════════════════════════════════════════════

export function buildRulesEmbed(tournamentName, rules) {
  const safeName = tournamentName.length > 30 ? tournamentName.substring(0, 29) + '…' : tournamentName;

  const embed = new EmbedBuilder()
    .setTitle(`📜 Rules — ${safeName}`)
    .setColor(COLORS.INFO)
    .setTimestamp();

  if (rules && rules.trim().length > 0) {
    embed.setDescription(rules);
  } else {
    embed.setDescription(
      '📭 **No rules have been set for this tournament yet.**\n\n' +
      '_The tournament organiser can add rules through the admin panel using the **Configure** button._',
    );
  }

  embed.setFooter({ text: 'Rules are set by the tournament organiser' });
  return embed;
}

export async function refreshRules(guild, tournament) {
  if (!tournament.rules_channel_id || !tournament.rules_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.rules_channel_id, tournament.rules_message_id);
    if (!result) return;

    const embed = buildRulesEmbed(tournament.name, tournament.rules);

    if (result.message) {
      await result.message.edit({ embeds: [embed] });
    } else {
      const newMsg = await result.channel.send({ embeds: [embed] });
      updateTournamentMessageId(tournament.id, 'rules_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[RULES] Message was deleted — recreated');
    }
  } catch (err) {
    console.warn('[RULES] Could not refresh rules:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  LEADERBOARD (Canvas Image)
// ═════════════════════════════════════════════════════════════════

export async function refreshLeaderboard(guild, tournament) {
  if (!tournament.leaderboard_channel_id || !tournament.leaderboard_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.leaderboard_channel_id, tournament.leaderboard_message_id);
    if (!result) return;

    const leaderboard = getLeaderboard(tournament.id);
    const completed   = getCompletedMatchCount(tournament.id);
    const total       = getTotalMatchCount(tournament.id);

    const buffer     = generateLeaderboardImage(tournament, leaderboard, completed, total);
    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });

    const payload = {
      content: '',
      embeds: [],
      files: [attachment],
      attachments: [],
    };

    if (result.message) {
      await result.message.edit(payload);
    } else {
      const newMsg = await result.channel.send(payload);
      updateTournamentMessageId(tournament.id, 'leaderboard_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[LEADERBOARD] Message was deleted — recreated');
    }
  } catch (err) {
    console.error('[LEADERBOARD] Could not refresh:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  BRACKET (Canvas Image)
// ═════════════════════════════════════════════════════════════════

export async function refreshBracket(guild, tournament) {
  if (!tournament.bracket_channel_id || !tournament.bracket_message_id) return;

  try {
    const result = await safeFetchMessage(guild, tournament.bracket_channel_id, tournament.bracket_message_id);
    if (!result) return;

    const allMatches = getMatchesByTournament(tournament.id);
    const matchesByRound = {};
    for (const m of allMatches) {
      if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
      matchesByRound[m.round].push(m);
    }

    const participants   = getParticipantsByTournament(tournament.id);
    const participantMap = new Map();
    for (const p of participants) {
      participantMap.set(p.user_id, {
        display_name: p.display_name,
        username:     p.username,
      });
    }

    const buffer     = generateBracketImage(tournament, matchesByRound, participantMap);
    const attachment = new AttachmentBuilder(buffer, { name: 'bracket.png' });

    const payload = {
      content: '',
      embeds: [],
      files: [attachment],
      attachments: [],
    };

    if (result.message) {
      await result.message.edit(payload);
    } else {
      const newMsg = await result.channel.send(payload);
      updateTournamentMessageId(tournament.id, 'bracket_message_id', newMsg.id);
      await safePin(newMsg);
      console.log('[BRACKET] Message was deleted — recreated');
    }
  } catch (err) {
    console.error('[BRACKET] Could not refresh:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  OPEN / CLOSE REGISTRATION
// ═════════════════════════════════════════════════════════════════

export async function openRegistration(guild, tournament) {
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.REGISTRATION_OPEN);

  const fresh = getTournamentById(tournament.id);
  await refreshRegistrationMessage(guild, fresh);
  await refreshAdminPanel(guild, fresh);

  await sendTournamentNotice(guild, fresh, new EmbedBuilder()
    .setTitle('📝 Registration Open!')
    .setDescription(
      `Registration for **${fresh.name}** is now open!\n` +
      `Head to <#${fresh.registration_channel_id}> to sign up.`,
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp(),
  true);
}

export async function closeRegistration(guild, tournament) {
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.REGISTRATION_CLOSED);

  const fresh = getTournamentById(tournament.id);
  await refreshRegistrationMessage(guild, fresh);
  await refreshAdminPanel(guild, fresh);

  await sendTournamentNotice(guild, fresh, new EmbedBuilder()
    .setTitle('🔒 Registration Closed')
    .setDescription(`Registration for **${fresh.name}** is now closed.`)
    .setColor(COLORS.WARNING)
    .setTimestamp(),
  true);
}

// ═════════════════════════════════════════════════════════════════
//  START TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function startTournament(guild, tournament) {
  const participants = getActiveParticipants(tournament.id);

  if (participants.length < 2) {
    throw new Error('At least **2 active participants** are required to start.');
  }

  // Generate schedule
  const playerIds = participants.map(p => p.user_id);
  const { totalRounds, matches } = generateRoundRobinSchedule(playerIds);

  // Bulk-insert matches
  const matchRows = matches.map(m => ({
    tournamentId: tournament.id,
    round:        m.round,
    matchNumber:  m.matchNumber,
    player1Id:    m.player1Id,
    player2Id:    m.player2Id,
  }));
  createMatchesBulk(matchRows);

  // Update tournament state
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.IN_PROGRESS);
  updateTournamentRound(tournament.id, 1, totalRounds);

  const fresh = getTournamentById(tournament.id);

  // Refresh embeds
  await refreshAdminPanel(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  // Notice with @everyone
  await sendTournamentNotice(guild, fresh, new EmbedBuilder()
    .setTitle('🚀 Tournament Started!')
    .setDescription(
      `**${fresh.name}** has begun!\n\n` +
      `👥 **${participants.length}** participants\n` +
      `⚔️ **${matches.length}** matches across **${totalRounds}** round(s)\n` +
      `📋 Format: Round Robin · Best of ${fresh.best_of}`,
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp(),
  true);

  console.log(`[TOURNAMENT] Started "${fresh.name}" — ${matches.length} matches, ${totalRounds} rounds`);

  // Initial leaderboard
  await refreshLeaderboard(guild, fresh);

  // Launch first round matches
  await launchAvailableMatches(guild, fresh);

  // Bracket AFTER launching (so it shows LIVE status)
  const freshAfterLaunch = getTournamentById(tournament.id);
  await refreshBracket(guild, freshAfterLaunch);

  return freshAfterLaunch;
}

// ═════════════════════════════════════════════════════════════════
//  LAUNCH AVAILABLE MATCHES (current round only)
// ═════════════════════════════════════════════════════════════════

export async function launchAvailableMatches(guild, tournament) {
  const fresh        = getTournamentById(tournament.id);
  const currentRound = fresh.current_round;

  if (currentRound <= 0) {
    console.log(`[MATCH] No current round set for "${tournament.name}"`);
    return 0;
  }

  const available = getAvailableMatchesForRound(tournament.id, currentRound);

  if (available.length === 0) {
    const remaining = getRemainingMatchCountForRound(tournament.id, currentRound);
    if (remaining > 0) {
      console.log(`[MATCH] Round ${currentRound}: ${remaining} match(es) still in progress, waiting…`);
    } else {
      console.log(`[MATCH] Round ${currentRound}: no matches to launch for "${tournament.name}"`);
    }
    return 0;
  }

  // Greedy: each player only gets ONE new thread
  const busyPlayers = new Set();
  const toCreate    = [];

  for (const match of available) {
    const p1Busy = busyPlayers.has(match.player1_id);
    const p2Busy = busyPlayers.has(match.player2_id);

    if (!p1Busy && !p2Busy) {
      toCreate.push(match);
      busyPlayers.add(match.player1_id);
      busyPlayers.add(match.player2_id);
    }
  }

  if (toCreate.length === 0) return 0;

  console.log(`[MATCH] Launching ${toCreate.length} thread(s) for Round ${currentRound} of "${tournament.name}"`);
  const created = await createMatchThreads(guild, fresh, toCreate);
  return created;
}

// ═════════════════════════════════════════════════════════════════
//  END TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function endTournament(guild, tournament) {
  cancelAllPendingMatches(tournament.id);
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh       = getTournamentById(tournament.id);
  const leaderboard = getLeaderboard(tournament.id);
  const completed   = getCompletedMatchCount(tournament.id);
  const total       = getTotalMatchCount(tournament.id);

  // Refresh canvas images
  await refreshLeaderboard(guild, fresh);
  await refreshBracket(guild, fresh);

  // Build results embed
  const resultsEmbed = new EmbedBuilder()
    .setTitle(`🏁 Tournament Complete — ${fresh.name}`)
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  if (leaderboard.length === 0 || completed === 0) {
    resultsEmbed.setDescription('The tournament ended with no completed matches.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    let description = '**Final Standings:**\n\n';

    const top = leaderboard.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const p      = top[i];
      const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
      const dqTag  = p.status === 'disqualified' ? ' *(DQ)*' : '';
      description += `${prefix} <@${p.user_id}>${dqTag} — ${p.points} pts (${p.wins}W / ${p.losses}L / ${p.draws}D)\n`;
    }

    resultsEmbed.setDescription(description);
    resultsEmbed.addFields(
      { name: 'Matches Played', value: `${completed} / ${total}`, inline: true },
    );

    if (leaderboard.length > 0) {
      const winner = leaderboard[0];
      resultsEmbed.addFields({
        name: '🏆 Winner',
        value: `<@${winner.user_id}> with **${winner.points}** points!`,
      });
    }
  }

  // Refresh & notify with @everyone
  await refreshAdminPanel(guild, fresh);
  await sendTournamentNotice(guild, fresh, resultsEmbed, true);

  // DM all participants
  const participants = getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank   = leaderboard.findIndex(l => l.user_id === p.user_id) + 1;
    const medals = ['🥇', '🥈', '🥉'];
    const medal  = rank > 0 && rank <= 3 ? medals[rank - 1] : '';

    try {
      const member = await guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${medal} Tournament Ended — ${fresh.name}`)
              .setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO)
              .setDescription(
                `**${fresh.name}** has ended!\n\n` +
                `🏅 **Rank:** #${rank}\n` +
                `⭐ **Points:** ${p.points}\n` +
                `✅ **Wins:** ${p.wins} · ❌ **Losses:** ${p.losses} · 🤝 **Draws:** ${p.draws}\n` +
                `🎮 **Matches Played:** ${p.matches_played}`,
              )
              .setFooter({ text: guild.name })
              .setTimestamp(),
          ],
        });
      }
    } catch {
      // DMs disabled
    }
  }

  console.log(`[TOURNAMENT] Ended "${fresh.name}"`);
  return fresh;
}

// ═════════════════════════════════════════════════════════════════
//  DELETE TOURNAMENT
// ═════════════════════════════════════════════════════════════════

export async function deleteTournamentInfrastructure(guild, tournament) {
  const reason = `Tournament deleted: ${tournament.name}`;

  // Delete channels
  const channelIds = [
    tournament.leaderboard_channel_id,
    tournament.admin_channel_id,
    tournament.notice_channel_id,
    tournament.rules_channel_id,
    tournament.registration_channel_id,
    tournament.participation_channel_id,
    tournament.bracket_channel_id,
    tournament.result_channel_id,
    tournament.chat_channel_id,
    tournament.match_channel_id,
  ].filter(Boolean);

  for (const chId of channelIds) {
    try {
      const ch = await guild.channels.fetch(chId).catch(() => null);
      if (ch) await ch.delete(reason);
    } catch (err) {
      console.warn(`[DELETE] Could not delete channel ${chId}:`, err.message);
    }
  }

  // Delete category
  if (tournament.category_id) {
    try {
      const cat = await guild.channels.fetch(tournament.category_id).catch(() => null);
      if (cat) await cat.delete(reason);
    } catch (err) {
      console.warn('[DELETE] Could not delete category:', err.message);
    }
  }

  // Delete per-tournament roles
  const roleIds = [
    tournament.participant_role_id,
    tournament.spectator_role_id,
  ].filter(Boolean);

  for (const roleId of roleIds) {
    try {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (role) await role.delete(reason);
    } catch (err) {
      console.warn(`[DELETE] Could not delete role ${roleId}:`, err.message);
    }
  }

  // Delete from database
  deleteTournament(tournament.id);

  console.log(`[TOURNAMENT] Deleted "${tournament.name}" (${tournament.id})`);
}

// ═════════════════════════════════════════════════════════════════
//  ORGANISER ROLE
// ═════════════════════════════════════════════════════════════════

export async function getOrCreateOrganizerRole(guild) {
  let role = guild.roles.cache.find(r => r.name === ROLE_NAMES.ORGANIZER);
  if (!role) {
    role = await guild.roles.create({
      name: ROLE_NAMES.ORGANIZER,
      color: 0x5865F2,
      mentionable: false,
      reason: 'Tournament Bot — Organizer role',
    });
    console.log(`[ROLE] Created ${ROLE_NAMES.ORGANIZER} in ${guild.name}`);
  }
  return role;
}

// ═════════════════════════════════════════════════════════════════
//  MAIN CREATION FLOW
// ═════════════════════════════════════════════════════════════════

export async function createTournamentInfrastructure(guild, botUser, tournamentName, createdBy) {
  const tournamentId = generateId();
  const reason       = `Tournament: ${tournamentName}`;

  const createdRoles    = [];
  const createdChannels = {};
  let category = null;

  try {
    // 1. DB entry
    dbCreateTournament({ id: tournamentId, guildId: guild.id, name: tournamentName, createdBy });

    // 2. Server-wide organiser role
    const organizerRole = await getOrCreateOrganizerRole(guild);
    try {
      const creator = await guild.members.fetch(createdBy);
      if (!creator.roles.cache.has(organizerRole.id)) {
        await creator.roles.add(organizerRole, reason);
      }
    } catch (err) {
      console.warn('[ROLE] Could not assign organiser role to creator:', err.message);
    }

    // 3. Per-tournament roles
    const participantRole = await guild.roles.create({
      name: `${tournamentName} ${ROLE_NAMES.PARTICIPANT}`,
      color: 0x57F287,
      mentionable: false,
      reason,
    });
    createdRoles.push(participantRole);

    const spectatorRole = await guild.roles.create({
      name: `${tournamentName} ${ROLE_NAMES.SPECTATOR}`,
      color: 0xFEE75C,
      mentionable: false,
      reason,
    });
    createdRoles.push(spectatorRole);

    // 4. Category
    category = await guild.channels.create({
      name: `🏆 ${tournamentName}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.CreatePublicThreads,
          ],
        },
        { id: botUser.id, allow: BOT_CHANNEL_PERMS },
      ],
      reason,
    });

    // 5. Permission bundle
    const roleIds = {
      guildId:           guild.id,
      botId:             botUser.id,
      organizerRoleId:   organizerRole.id,
      participantRoleId: participantRole.id,
      spectatorRoleId:   spectatorRole.id,
    };

    // 6. Channel definitions
    const channelDefs = [
      { key: 'leaderboard',   name: CHANNEL_NAMES.LEADERBOARD,   topic: 'Tournament leaderboard and standings' },
      { key: 'admin',         name: CHANNEL_NAMES.ADMIN,         topic: 'Tournament administration panel',       perms: buildAdminPerms(roleIds) },
      { key: 'notice',        name: CHANNEL_NAMES.NOTICE,        topic: 'Tournament announcements and notices' },
      { key: 'rules',         name: CHANNEL_NAMES.RULES,         topic: 'Tournament rules and guidelines' },
      { key: 'registration',  name: CHANNEL_NAMES.REGISTRATION,  topic: 'Register, unregister, or spectate' },
      { key: 'participation', name: CHANNEL_NAMES.PARTICIPATION, topic: 'Current participant list' },
      { key: 'bracket',       name: CHANNEL_NAMES.BRACKET,       topic: 'Tournament bracket' },
      { key: 'result',        name: CHANNEL_NAMES.RESULT,        topic: 'Match results' },
      { key: 'chat',          name: CHANNEL_NAMES.CHAT,          topic: 'Participant chat — spectators can view', perms: buildChatPerms(roleIds) },
      { key: 'match',         name: CHANNEL_NAMES.MATCH,         topic: 'Match threads',                          perms: buildMatchPerms(roleIds) },
    ];

    // 7. Create channels
    for (const def of channelDefs) {
      const opts = { name: def.name, type: ChannelType.GuildText, parent: category.id, topic: def.topic, reason };
      if (def.perms) opts.permissionOverwrites = def.perms;
      createdChannels[def.key] = await guild.channels.create(opts);
    }

    // 8. Save IDs to DB
    updateTournamentChannels(tournamentId, {
      categoryId:             category.id,
      leaderboardChannelId:   createdChannels.leaderboard.id,
      adminChannelId:         createdChannels.admin.id,
      noticeChannelId:        createdChannels.notice.id,
      registrationChannelId:  createdChannels.registration.id,
      participationChannelId: createdChannels.participation.id,
      bracketChannelId:       createdChannels.bracket.id,
      resultChannelId:        createdChannels.result.id,
      chatChannelId:          createdChannels.chat.id,
      matchChannelId:         createdChannels.match.id,
      rulesChannelId:         createdChannels.rules.id,
    });

    updateTournamentRoles(tournamentId, {
      organizerRoleId:   organizerRole.id,
      participantRoleId: participantRole.id,
      spectatorRoleId:   spectatorRole.id,
    });

    // 9. Send initial messages + pin important ones
    const adminPanel = buildAdminPanel(getTournamentById(tournamentId));
    const adminMsg   = await createdChannels.admin.send(adminPanel);
    updateTournamentMessageId(tournamentId, 'admin_message_id', adminMsg.id);
    await safePin(adminMsg);

    const lbMsg = await createdChannels.leaderboard.send({
      embeds: [new EmbedBuilder().setTitle('📊 Leaderboard').setDescription('Leaderboard will appear here once the tournament starts.').setColor(COLORS.NEUTRAL).setTimestamp()],
    });
    updateTournamentMessageId(tournamentId, 'leaderboard_message_id', lbMsg.id);
    await safePin(lbMsg);

    const bracketMsg = await createdChannels.bracket.send({
      embeds: [new EmbedBuilder().setTitle('🔀 Bracket').setDescription('Bracket will appear here once the tournament starts.').setColor(COLORS.NEUTRAL).setTimestamp()],
    });
    updateTournamentMessageId(tournamentId, 'bracket_message_id', bracketMsg.id);
    await safePin(bracketMsg);

    const partMsg = await createdChannels.participation.send({
      embeds: [new EmbedBuilder().setTitle('👥 Participants').setDescription('No participants registered yet.').setColor(COLORS.NEUTRAL).setTimestamp()],
    });
    updateTournamentMessageId(tournamentId, 'participation_message_id', partMsg.id);
    await safePin(partMsg);

    const regMsg = await createdChannels.registration.send({
      embeds: [new EmbedBuilder().setTitle('📋 Registration').setDescription('Registration is not open yet. Stay tuned!').setColor(COLORS.NEUTRAL).setTimestamp()],
    });
    updateTournamentMessageId(tournamentId, 'registration_message_id', regMsg.id);
    await safePin(regMsg);

    const rulesMsg = await createdChannels.rules.send({
      embeds: [buildRulesEmbed(tournamentName, '')],
    });
    updateTournamentMessageId(tournamentId, 'rules_message_id', rulesMsg.id);
    await safePin(rulesMsg);

    await createdChannels.notice.send({
      embeds: [new EmbedBuilder().setTitle('📢 Tournament Notices').setDescription(`Welcome to **${tournamentName}**!\nImportant announcements will appear here.`).setColor(COLORS.INFO).setTimestamp()],
    });

    await createdChannels.result.send({
      embeds: [new EmbedBuilder().setTitle('📋 Match Results').setDescription('Match results will appear here as games are completed.').setColor(COLORS.NEUTRAL).setTimestamp()],
    });

    await createdChannels.chat.send({
      embeds: [new EmbedBuilder().setTitle('💬 Tournament Chat').setDescription('This channel is for tournament participants to chat.\nSpectators and others can read but not send messages.').setColor(COLORS.INFO).setTimestamp()],
    });

    await createdChannels.match.send({
      embeds: [new EmbedBuilder().setTitle('⚔️ Matches').setDescription('Match threads will be created here when the tournament starts.').setColor(COLORS.NEUTRAL).setTimestamp()],
    });

    console.log(`[TOURNAMENT] Created "${tournamentName}" (${tournamentId}) in ${guild.name}`);
    return getTournamentById(tournamentId);

  } catch (error) {
    console.error('[TOURNAMENT] Creation failed — cleaning up:', error.message);
    for (const ch of Object.values(createdChannels)) {
      try { await ch.delete('Tournament creation failed — cleanup'); } catch { /* ignore */ }
    }
    if (category) {
      try { await category.delete('Tournament creation failed — cleanup'); } catch { /* ignore */ }
    }
    for (const role of createdRoles) {
      try { await role.delete('Tournament creation failed — cleanup'); } catch { /* ignore */ }
    }
    try { deleteTournament(tournamentId); } catch { /* ignore */ }
    throw error;
  }
}
