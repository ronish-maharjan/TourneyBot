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
} from "discord.js";
import {
  CHANNEL_NAMES,
  ROLE_NAMES,
  COLORS,
  TOURNAMENT_STATUS,
} from "../config.js";
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
  getAllAvailableMatches,
  updateTournamentChannels,
  updateTournamentRoles,
  updateTournamentMessageId,
  updateTournamentStatus,
  updateTournamentRound,
  deleteTournament,
  createMatchesBulk,
  cancelAllPendingMatches,
} from "../database/queries.js";
import { generateRoundRobinSchedule } from "./matchService.js";
import { createMatchThreads } from "./threadService.js";
import { generateLeaderboardImage } from "../canvas/leaderboard.js";
import { generateBracketImage } from "../canvas/bracket.js";
import { generateId, formatStatus } from "../utils/helpers.js";

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
//  PERMISSION BUILDERS  (per-channel overwrite arrays)
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
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
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

function buildMatchPerms({ guildId, botId, participantRoleId }) {
  return [
    {
      id: guildId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
      ],
    },
    {
      id: participantRoleId,
      allow: [PermissionFlagsBits.SendMessagesInThreads],
    },
    { id: botId, allow: BOT_CHANNEL_PERMS },
  ];
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═════════════════════════════════════════════════════════════════

/**
 * Build the admin panel embed + action-row buttons.
 * @param {object} tournament  DB row.
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildAdminPanel(tournament) {
  const status = tournament.status;
  const id = tournament.id;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Admin Panel — ${tournament.name}`)
    .setColor(COLORS.PRIMARY)
    .addFields(
      { name: "Status", value: formatStatus(status), inline: true },
      { name: "Format", value: "Round Robin", inline: true },
      { name: "Best Of", value: `${tournament.best_of}`, inline: true },
      {
        name: "Team Size",
        value: tournament.team_size === 1 ? "Solo" : "Duo",
        inline: true,
      },
      { name: "Max Players", value: `${tournament.max_players}`, inline: true },
      { name: "ID", value: `\`${id}\``, inline: true },
    );

  if (tournament.rules && tournament.rules.trim()) {
    embed.addFields({
      name: "📜 Rules",
      value: tournament.rules.substring(0, 1024),
    });
  }

  // Player count when relevant
  if (status !== TOURNAMENT_STATUS.CREATED) {
    const registered = getParticipantCount(id);
    const active = getActiveParticipantCount(id);
    embed.addFields({
      name: "👥 Players",
      value: `${active} active / ${registered} registered / ${tournament.max_players} max`,
      inline: false,
    });
  }

  // Match progress when in progress or completed
  if (
    status === TOURNAMENT_STATUS.IN_PROGRESS ||
    status === TOURNAMENT_STATUS.COMPLETED
  ) {
    const completed = getCompletedMatchCount(id);
    const total = getTotalMatchCount(id);
    embed.addFields({
      name: "⚔️ Matches",
      value: `${completed} / ${total} completed`,
      inline: true,
    });
    if (tournament.total_rounds > 0) {
      embed.addFields({
        name: "🔄 Rounds",
        value: `${tournament.current_round} / ${tournament.total_rounds}`,
        inline: true,
      });
    }
  }

  embed
    .setFooter({ text: "Use the buttons below to manage the tournament" })
    .setTimestamp();

  // ── Buttons ──────────────────────────────────────────────────
  const isEditable = ![
    TOURNAMENT_STATUS.IN_PROGRESS,
    TOURNAMENT_STATUS.COMPLETED,
    TOURNAMENT_STATUS.CANCELLED,
  ].includes(status);

  const configureBtn = new ButtonBuilder()
    .setCustomId(`admin_configure_${id}`)
    .setLabel("Configure")
    .setEmoji("⚙️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!isEditable);

  let regBtn;
  if (status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    regBtn = new ButtonBuilder()
      .setCustomId(`admin_closereg_${id}`)
      .setLabel("Close Registration")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);
  } else {
    regBtn = new ButtonBuilder()
      .setCustomId(`admin_openreg_${id}`)
      .setLabel("Open Registration")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isEditable);
  }

  const startBtn = new ButtonBuilder()
    .setCustomId(`admin_start_${id}`)
    .setLabel("Start Tournament")
    .setEmoji("🚀")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED);

  const endBtn = new ButtonBuilder()
    .setCustomId(`admin_end_${id}`)
    .setLabel("End Tournament")
    .setEmoji("🏁")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(status !== TOURNAMENT_STATUS.IN_PROGRESS);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`admin_delete_${id}`)
    .setLabel("Delete Tournament")
    .setEmoji("🗑️")
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(
    configureBtn,
    regBtn,
    startBtn,
  );
  const row2 = new ActionRowBuilder().addComponents(endBtn, deleteBtn);

  return { embeds: [embed], components: [row1, row2] };
}

/**
 * Re-fetch tournament from DB and edit the admin-panel message in-place.
 */
export async function refreshAdminPanel(guild, tournament) {
  if (!tournament.admin_channel_id || !tournament.admin_message_id) return;
  try {
    const channel = await guild.channels.fetch(tournament.admin_channel_id);
    if (!channel) return;
    const message = await channel.messages.fetch(tournament.admin_message_id);
    if (!message) return;
    const fresh = getTournamentById(tournament.id);
    if (!fresh) return;
    await message.edit(buildAdminPanel(fresh));
  } catch (err) {
    console.warn("[ADMIN] Could not refresh admin panel:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  REGISTRATION MESSAGE
// ═════════════════════════════════════════════════════════════════

/**
 * Edit the registration-channel message based on current status.
 */
export async function refreshRegistrationMessage(guild, tournament) {
  if (
    !tournament.registration_channel_id ||
    !tournament.registration_message_id
  )
    return;
  try {
    const channel = await guild.channels.fetch(
      tournament.registration_channel_id,
    );
    if (!channel) return;
    const message = await channel.messages.fetch(
      tournament.registration_message_id,
    );
    if (!message) return;

    const isOpen = tournament.status === TOURNAMENT_STATUS.REGISTRATION_OPEN;

    if (isOpen) {
      const count = getParticipantCount(tournament.id);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Registration — ${tournament.name}`)
        .setColor(COLORS.SUCCESS)
        .setDescription(
          "Click a button below to register, unregister, or become a spectator!",
        )
        .addFields(
          { name: "Status", value: "📝 Open", inline: true },
          {
            name: "Players",
            value: `${count} / ${tournament.max_players}`,
            inline: true,
          },
          {
            name: "Team Size",
            value: tournament.team_size === 1 ? "Solo" : "Duo",
            inline: true,
          },
          { name: "Format", value: "Round Robin", inline: true },
          { name: "Best Of", value: `${tournament.best_of}`, inline: true },
        )
        .setTimestamp();

      if (tournament.rules?.trim()) {
        embed.addFields({
          name: "📜 Rules",
          value: tournament.rules.substring(0, 1024),
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reg_register_${tournament.id}`)
          .setLabel("Register")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reg_unregister_${tournament.id}`)
          .setLabel("Unregister")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`reg_spectate_${tournament.id}`)
          .setLabel("Spectate")
          .setEmoji("👁️")
          .setStyle(ButtonStyle.Secondary),
      );

      await message.edit({ embeds: [embed], components: [row] });
    } else {
      const count = getParticipantCount(tournament.id);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Registration — ${tournament.name}`)
        .setColor(COLORS.DANGER)
        .setDescription("Registration is now **closed**.")
        .addFields({
          name: "Registered Players",
          value: `${count}`,
          inline: true,
        })
        .setTimestamp();

      await message.edit({ embeds: [embed], components: [] });
    }
  } catch (err) {
    console.warn("[REG] Could not refresh registration message:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  PARTICIPATION LIST
// ═════════════════════════════════════════════════════════════════

/**
 * Edit the participation-channel message with current player list.
 */
export async function refreshParticipationList(guild, tournament) {
  if (
    !tournament.participation_channel_id ||
    !tournament.participation_message_id
  )
    return;
  try {
    const channel = await guild.channels.fetch(
      tournament.participation_channel_id,
    );
    if (!channel) return;
    const message = await channel.messages.fetch(
      tournament.participation_message_id,
    );
    if (!message) return;

    const participants = getActiveParticipants(tournament.id);
    const spectators = getSpectators(tournament.id);

    const embed = new EmbedBuilder()
      .setTitle(`👥 Participants — ${tournament.name}`)
      .setColor(COLORS.INFO)
      .setTimestamp();

    if (participants.length === 0) {
      embed.setDescription("No participants registered yet.");
    } else {
      const list = participants
        .map((p, i) => `**${i + 1}.** <@${p.user_id}> (${p.username})`)
        .join("\n");
      embed.addFields({
        name: `Participants (${participants.length}/${tournament.max_players})`,
        value: list.substring(0, 1024),
      });
    }

    if (spectators.length > 0) {
      const sList = spectators.map((s) => `<@${s.user_id}>`).join(", ");
      embed.addFields({
        name: `Spectators (${spectators.length})`,
        value: sList.substring(0, 1024),
      });
    }

    await message.edit({ embeds: [embed] });
  } catch (err) {
    console.warn("[PARTICIPATION] Could not refresh:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  LEADERBOARD (Canvas Image)
// ═════════════════════════════════════════════════════════════════

export async function refreshLeaderboard(guild, tournament) {
  if (
    !tournament.leaderboard_channel_id ||
    !tournament.leaderboard_message_id
  ) {
    console.log("[LEADERBOARD] No channel/message ID — skipping");
    return;
  }

  try {
    const channel = await guild.channels.fetch(
      tournament.leaderboard_channel_id,
    );
    if (!channel) {
      console.log("[LEADERBOARD] Channel not found");
      return;
    }

    const message = await channel.messages.fetch(
      tournament.leaderboard_message_id,
    );
    if (!message) {
      console.log("[LEADERBOARD] Message not found");
      return;
    }

    const leaderboard = getLeaderboard(tournament.id);
    const completed = getCompletedMatchCount(tournament.id);
    const total = getTotalMatchCount(tournament.id);

    console.log(
      `[LEADERBOARD] Generating image: ${leaderboard.length} players, ${completed}/${total} matches`,
    );

    const buffer = generateLeaderboardImage(
      tournament,
      leaderboard,
      completed,
      total,
    );
    const attachment = new AttachmentBuilder(buffer, {
      name: "leaderboard.png",
    });

    await message.edit({
      content: "",
      embeds: [],
      files: [attachment],
      attachments: [],
    });

    console.log("[LEADERBOARD] Image updated successfully");
  } catch (err) {
    console.error("[LEADERBOARD] Error refreshing:", err);
  }
}

// ═════════════════════════════════════════════════════════════════
//  BRACKET (Canvas Image)
// ═════════════════════════════════════════════════════════════════

export async function refreshBracket(guild, tournament) {
  if (!tournament.bracket_channel_id || !tournament.bracket_message_id) {
    console.log("[BRACKET] No channel/message ID — skipping");
    return;
  }

  try {
    const channel = await guild.channels.fetch(tournament.bracket_channel_id);
    if (!channel) {
      console.log("[BRACKET] Channel not found");
      return;
    }

    const message = await channel.messages.fetch(tournament.bracket_message_id);
    if (!message) {
      console.log("[BRACKET] Message not found");
      return;
    }

    const allMatches = getMatchesByTournament(tournament.id);
    const matchesByRound = {};
    for (const m of allMatches) {
      if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
      matchesByRound[m.round].push(m);
    }

    const participants = getParticipantsByTournament(tournament.id);
    const participantMap = new Map();
    for (const p of participants) {
      participantMap.set(p.user_id, {
        display_name: p.display_name,
        username: p.username,
      });
    }

    console.log(
      `[BRACKET] Generating image: ${allMatches.length} matches, ${Object.keys(matchesByRound).length} rounds`,
    );

    const buffer = generateBracketImage(
      tournament,
      matchesByRound,
      participantMap,
    );
    const attachment = new AttachmentBuilder(buffer, { name: "bracket.png" });

    await message.edit({
      content: "",
      embeds: [],
      files: [attachment],
      attachments: [],
    });

    console.log("[BRACKET] Image updated successfully");
  } catch (err) {
    console.error("[BRACKET] Error refreshing:", err);
  }
}

// ═════════════════════════════════════════════════════════════════
//  NOTICE HELPER
// ═════════════════════════════════════════════════════════════════

/**
 * Send an embed to the tournament's notice channel.
 * @param {import('discord.js').Guild} guild
 * @param {object}       tournament
 * @param {EmbedBuilder} embed
 * @param {boolean}      pingEveryone  If true, pings @everyone
 */
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
//  OPEN / CLOSE REGISTRATION
// ═════════════════════════════════════════════════════════════════

/**
 * Open registration: update status, edit messages, send notice.
 */
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
  true);   // ← @everyone
}

/**
 * Close registration: update status, edit messages.
 */
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
  true);   // ← @everyone
}

// ═════════════════════════════════════════════════════════════════
//  START TOURNAMENT
// ═════════════════════════════════════════════════════════════════

/**
 * Start the tournament:
 *   1. Validate minimum players.
 *   2. Generate round-robin schedule.
 *   3. Bulk-insert matches.
 *   4. Update status and round tracking.
 *   5. Refresh embeds and send notice.
 *
 * @returns {object} Fresh tournament row from DB.
 * @throws {Error}   If validation fails.
 */
// ═════════════════════════════════════════════════════════════════
//  START TOURNAMENT
// ═════════════════════════════════════════════════════════════════

/**
 * Start the tournament:
 *   1. Validate minimum players.
 *   2. Generate round-robin schedule.
 *   3. Bulk-insert matches.
 *   4. Update status and round tracking.
 *   5. Refresh embeds and send notice.
 *   6. Find first batch of available matches and create threads.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament  DB row
 * @returns {Promise<object>}  Fresh tournament row from DB.
 * @throws {Error} If validation fails.
 */
export async function startTournament(guild, tournament) {
  const participants = getActiveParticipants(tournament.id);

  if (participants.length < 2) {
    throw new Error(
      "At least **2 active participants** are required to start.",
    );
  }

  // ── Generate schedule ──────────────────────────────────────
  const playerIds = participants.map((p) => p.user_id);
  const { totalRounds, matches } = generateRoundRobinSchedule(playerIds);

  // ── Bulk-insert matches ────────────────────────────────────
  const matchRows = matches.map((m) => ({
    tournamentId: tournament.id,
    round: m.round,
    matchNumber: m.matchNumber,
    player1Id: m.player1Id,
    player2Id: m.player2Id,
  }));
  createMatchesBulk(matchRows);

  // ── Update tournament state ────────────────────────────────
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.IN_PROGRESS);
  updateTournamentRound(tournament.id, 1, totalRounds);

  const fresh = getTournamentById(tournament.id);

  // ── Refresh embeds ─────────────────────────────────────────
  await refreshAdminPanel(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  // ── Notice ─────────────────────────────────────────────────
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
  true);   // ← @everyone
  console.log(
    `[TOURNAMENT] Started "${fresh.name}" — ${matches.length} matches, ${totalRounds} rounds`,
  );

  // ── Initial leaderboard (all players at 0 pts) ────────────
  await refreshLeaderboard(guild, fresh);

  // ── Initial bracket (all matches pending) ──────────────────
  await refreshBracket(guild, fresh);

  // ── Launch first batch of available matches ────────────────
  await launchAvailableMatches(guild, fresh);

  return fresh;
}

// ═════════════════════════════════════════════════════════════════
//  LAUNCH AVAILABLE MATCHES
// ═════════════════════════════════════════════════════════════════

/**
 * Find all pending matches where both players are free and create
 * threads for them.  Called on tournament start AND after each match
 * completes (from Stage 6D).
 *
 * "Free" means neither player currently has a match with status
 * 'in_progress'.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament  DB tournament row
 * @returns {Promise<number>}  Number of threads created
 */
export async function launchAvailableMatches(guild, tournament) {
  const available = getAllAvailableMatches(tournament.id);

  if (available.length === 0) {
    console.log(
      `[MATCH] No available matches to launch for "${tournament.name}"`,
    );
    return 0;
  }

  // Deduplicate: a player should only appear in ONE new thread
  // getAllAvailableMatches already excludes busy players, but a
  // player could appear in multiple "available" rows.  We pick
  // greedily: first-come-first-served by round then match_number.
  const busyPlayers = new Set();
  const toCreate = [];

  for (const match of available) {
    const p1Busy = busyPlayers.has(match.player1_id);
    const p2Busy = busyPlayers.has(match.player2_id);

    if (!p1Busy && !p2Busy) {
      toCreate.push(match);
      busyPlayers.add(match.player1_id);
      busyPlayers.add(match.player2_id);
    }
  }

  if (toCreate.length === 0) {
    return 0;
  }

  console.log(
    `[MATCH] Launching ${toCreate.length} match thread(s) for "${tournament.name}"`,
  );
  const created = await createMatchThreads(guild, tournament, toCreate);
  return created;
}

// ═════════════════════════════════════════════════════════════════
//  END TOURNAMENT
// ═════════════════════════════════════════════════════════════════

/**
 * End the tournament: cancel remaining matches, refresh images, announce results.
 */
export async function endTournament(guild, tournament) {
  // Cancel outstanding matches
  cancelAllPendingMatches(tournament.id);

  // Update status
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh = getTournamentById(tournament.id);
  const leaderboard = getLeaderboard(tournament.id);
  const completed = getCompletedMatchCount(tournament.id);
  const total = getTotalMatchCount(tournament.id);

  // ── Refresh canvas images ──────────────────────────────────
  await refreshLeaderboard(guild, fresh);
  await refreshBracket(guild, fresh);

  // ── Build results embed ────────────────────────────────────
  const resultsEmbed = new EmbedBuilder()
    .setTitle(`🏁 Tournament Complete — ${fresh.name}`)
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  if (leaderboard.length === 0 || completed === 0) {
    resultsEmbed.setDescription(
      "The tournament ended with no completed matches.",
    );
  } else {
    const medals = ["🥇", "🥈", "🥉"];
    let description = "**Final Standings:**\n\n";

    const top = leaderboard.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
      const dqTag = p.status === "disqualified" ? " *(DQ)*" : "";
      description += `${prefix} <@${p.user_id}>${dqTag} — ${p.points} pts (${p.wins}W / ${p.losses}L / ${p.draws}D)\n`;
    }

    resultsEmbed.setDescription(description);
    resultsEmbed.addFields({
      name: "Matches Played",
      value: `${completed} / ${total}`,
      inline: true,
    });

    if (leaderboard.length > 0) {
      const winner = leaderboard[0];
      resultsEmbed.addFields({
        name: "🏆 Winner",
        value: `<@${winner.user_id}> with **${winner.points}** points!`,
      });
    }
  }

  // ── Refresh & notify ───────────────────────────────────────
  await refreshAdminPanel(guild, fresh);
  await sendTournamentNotice(guild, fresh, resultsEmbed,true);

  // ── DM all participants with final results ─────────────────
  const participants = getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank = leaderboard.findIndex((l) => l.user_id === p.user_id) + 1;
    const medals = ["🥇", "🥈", "🥉"];
    const medal = rank > 0 && rank <= 3 ? medals[rank - 1] : "";

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

/**
 * Delete all Discord resources (channels, category, per-tournament roles)
 * and remove the tournament from the database.
 */
export async function deleteTournamentInfrastructure(guild, tournament) {
  const reason = `Tournament deleted: ${tournament.name}`;

  // ── 1. Collect channel IDs ─────────────────────────────────
  const channelIds = [
    tournament.leaderboard_channel_id,
    tournament.admin_channel_id,
    tournament.notice_channel_id,
    tournament.registration_channel_id,
    tournament.participation_channel_id,
    tournament.bracket_channel_id,
    tournament.result_channel_id,
    tournament.chat_channel_id,
    tournament.match_channel_id,
  ].filter(Boolean);

  // ── 2. Delete channels ─────────────────────────────────────
  for (const chId of channelIds) {
    try {
      const ch = await guild.channels.fetch(chId).catch(() => null);
      if (ch) await ch.delete(reason);
    } catch (err) {
      console.warn(`[DELETE] Could not delete channel ${chId}:`, err.message);
    }
  }

  // ── 3. Delete category ─────────────────────────────────────
  if (tournament.category_id) {
    try {
      const cat = await guild.channels
        .fetch(tournament.category_id)
        .catch(() => null);
      if (cat) await cat.delete(reason);
    } catch (err) {
      console.warn("[DELETE] Could not delete category:", err.message);
    }
  }

  // ── 4. Delete per-tournament roles (NOT organiser) ─────────
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

  // ── 5. Delete from database (cascades to participants & matches)
  deleteTournament(tournament.id);

  console.log(`[TOURNAMENT] Deleted "${tournament.name}" (${tournament.id})`);
}

// ═════════════════════════════════════════════════════════════════
//  ORGANISER ROLE (server-wide, created once)
// ═════════════════════════════════════════════════════════════════

export async function getOrCreateOrganizerRole(guild) {
  let role = guild.roles.cache.find((r) => r.name === ROLE_NAMES.ORGANIZER);
  if (!role) {
    role = await guild.roles.create({
      name: ROLE_NAMES.ORGANIZER,
      color: 0x5865f2,
      mentionable: false,
      reason: "Tournament Bot — Organizer role",
    });
    console.log(`[ROLE] Created ${ROLE_NAMES.ORGANIZER} in ${guild.name}`);
  }
  return role;
}

// ═════════════════════════════════════════════════════════════════
//  MAIN CREATION FLOW
// ═════════════════════════════════════════════════════════════════

export async function createTournamentInfrastructure(
  guild,
  botUser,
  tournamentName,
  createdBy,
) {
  const tournamentId = generateId();
  const reason = `Tournament: ${tournamentName}`;

  const createdRoles = [];
  const createdChannels = {};
  let category = null;

  try {
    // 1. DB entry
    dbCreateTournament({
      id: tournamentId,
      guildId: guild.id,
      name: tournamentName,
      createdBy,
    });

    // 2. Server-wide organiser role
    const organizerRole = await getOrCreateOrganizerRole(guild);
    try {
      const creator = await guild.members.fetch(createdBy);
      if (!creator.roles.cache.has(organizerRole.id)) {
        await creator.roles.add(organizerRole, reason);
      }
    } catch (err) {
      console.warn(
        "[ROLE] Could not assign organiser role to creator:",
        err.message,
      );
    }

    // 3. Per-tournament roles
    const participantRole = await guild.roles.create({
      name: `${tournamentName} ${ROLE_NAMES.PARTICIPANT}`,
      color: 0x57f287,
      mentionable: false,
      reason,
    });
    createdRoles.push(participantRole);

    const spectatorRole = await guild.roles.create({
      name: `${tournamentName} ${ROLE_NAMES.SPECTATOR}`,
      color: 0xfee75c,
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
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
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
      guildId: guild.id,
      botId: botUser.id,
      organizerRoleId: organizerRole.id,
      participantRoleId: participantRole.id,
      spectatorRoleId: spectatorRole.id,
    };

    // 6. Channel definitions
    const channelDefs = [
      {
        key: "leaderboard",
        name: CHANNEL_NAMES.LEADERBOARD,
        topic: "Tournament leaderboard and standings",
      },
      {
        key: "admin",
        name: CHANNEL_NAMES.ADMIN,
        topic: "Tournament administration panel",
        perms: buildAdminPerms(roleIds),
      },
      {
        key: "notice",
        name: CHANNEL_NAMES.NOTICE,
        topic: "Tournament announcements and notices",
      },
      {
        key: "registration",
        name: CHANNEL_NAMES.REGISTRATION,
        topic: "Register, unregister, or spectate",
      },
      {
        key: "participation",
        name: CHANNEL_NAMES.PARTICIPATION,
        topic: "Current participant list",
      },
      {
        key: "bracket",
        name: CHANNEL_NAMES.BRACKET,
        topic: "Tournament bracket",
      },
      { key: "result", name: CHANNEL_NAMES.RESULT, topic: "Match results" },
      {
        key: "chat",
        name: CHANNEL_NAMES.CHAT,
        topic: "Participant chat — spectators can view",
        perms: buildChatPerms(roleIds),
      },
      {
        key: "match",
        name: CHANNEL_NAMES.MATCH,
        topic: "Match threads",
        perms: buildMatchPerms(roleIds),
      },
    ];

    // 7. Create channels
    for (const def of channelDefs) {
      const opts = {
        name: def.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: def.topic,
        reason,
      };
      if (def.perms) opts.permissionOverwrites = def.perms;
      createdChannels[def.key] = await guild.channels.create(opts);
    }

    // 8. Save IDs to DB
    updateTournamentChannels(tournamentId, {
      categoryId: category.id,
      leaderboardChannelId: createdChannels.leaderboard.id,
      adminChannelId: createdChannels.admin.id,
      noticeChannelId: createdChannels.notice.id,
      registrationChannelId: createdChannels.registration.id,
      participationChannelId: createdChannels.participation.id,
      bracketChannelId: createdChannels.bracket.id,
      resultChannelId: createdChannels.result.id,
      chatChannelId: createdChannels.chat.id,
      matchChannelId: createdChannels.match.id,
    });

    updateTournamentRoles(tournamentId, {
      organizerRoleId: organizerRole.id,
      participantRoleId: participantRole.id,
      spectatorRoleId: spectatorRole.id,
    });

    // 9. Send initial messages
    const adminPanel = buildAdminPanel(getTournamentById(tournamentId));
    const adminMsg = await createdChannels.admin.send(adminPanel);
    updateTournamentMessageId(tournamentId, "admin_message_id", adminMsg.id);

    const lbMsg = await createdChannels.leaderboard.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 Leaderboard")
          .setDescription(
            "Leaderboard will appear here once the tournament starts.",
          )
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });
    updateTournamentMessageId(tournamentId, "leaderboard_message_id", lbMsg.id);

    const bracketMsg = await createdChannels.bracket.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔀 Bracket")
          .setDescription(
            "Bracket will appear here once the tournament starts.",
          )
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });
    updateTournamentMessageId(
      tournamentId,
      "bracket_message_id",
      bracketMsg.id,
    );

    const partMsg = await createdChannels.participation.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("👥 Participants")
          .setDescription("No participants registered yet.")
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });
    updateTournamentMessageId(
      tournamentId,
      "participation_message_id",
      partMsg.id,
    );

    const regMsg = await createdChannels.registration.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Registration")
          .setDescription("Registration is not open yet. Stay tuned!")
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });
    updateTournamentMessageId(
      tournamentId,
      "registration_message_id",
      regMsg.id,
    );

    await createdChannels.notice.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📢 Tournament Notices")
          .setDescription(
            `Welcome to **${tournamentName}**!\nImportant announcements will appear here.`,
          )
          .setColor(COLORS.INFO)
          .setTimestamp(),
      ],
    });

    await createdChannels.result.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Match Results")
          .setDescription(
            "Match results will appear here as games are completed.",
          )
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });

    await createdChannels.chat.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("💬 Tournament Chat")
          .setDescription(
            "This channel is for tournament participants to chat.\nSpectators and others can read but not send messages.",
          )
          .setColor(COLORS.INFO)
          .setTimestamp(),
      ],
    });

    await createdChannels.match.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("⚔️ Matches")
          .setDescription(
            "Match threads will be created here when the tournament starts.",
          )
          .setColor(COLORS.NEUTRAL)
          .setTimestamp(),
      ],
    });

    console.log(
      `[TOURNAMENT] Created "${tournamentName}" (${tournamentId}) in ${guild.name}`,
    );
    return getTournamentById(tournamentId);
  } catch (error) {
    console.error("[TOURNAMENT] Creation failed — cleaning up:", error.message);
    for (const ch of Object.values(createdChannels)) {
      try {
        await ch.delete("Tournament creation failed — cleanup");
      } catch {
        /* ignore */
      }
    }
    if (category) {
      try {
        await category.delete("Tournament creation failed — cleanup");
      } catch {
        /* ignore */
      }
    }
    for (const role of createdRoles) {
      try {
        await role.delete("Tournament creation failed — cleanup");
      } catch {
        /* ignore */
      }
    }
    try {
      deleteTournament(tournamentId);
    } catch {
      /* ignore */
    }
    throw error;
  }
}
