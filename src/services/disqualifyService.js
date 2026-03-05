// ─── src/services/disqualifyService.js ───────────────────────────
// Handles full disqualification logic: mark DQ, resolve matches,
// award opponents, update embeds, notify players.

import { EmbedBuilder } from "discord.js";
import {
  getTournamentById,
  getParticipant,
  getMatchById,
  getMatchesByPlayer,
  updateParticipantStatus,
  updateMatchResult,
  updateMatchStatus,
  incrementParticipantStats,
  isTournamentComplete,
  getLeaderboard,
  getCompletedMatchCount,
  getTotalMatchCount,
  getActiveParticipants,
} from "../database/queries.js";
import {
  COLORS,
  POINTS,
  PARTICIPANT_STATUS,
  TOURNAMENT_STATUS,
} from "../config.js";
import {
  refreshAdminPanel,
  refreshLeaderboard,
  refreshParticipationList,
  sendTournamentNotice,
  launchAvailableMatches,
} from "./tournamentService.js";
import { updateMatchThreadEmbed } from "./threadService.js";

// ═════════════════════════════════════════════════════════════════
//  MAIN DISQUALIFY FUNCTION
// ═════════════════════════════════════════════════════════════════

/**
 * Fully disqualify a player from a tournament:
 *
 *  1. Mark participant as disqualified.
 *  2. Complete/cancel all their pending & in-progress matches.
 *  3. Award wins to all opponents in those matches.
 *  4. Update match thread embeds.
 *  5. Remove participant role.
 *  6. Post notice in notice channel.
 *  7. DM the disqualified player.
 *  8. Refresh leaderboard, participation, admin panel.
 *  9. Launch newly available matches.
 * 10. Check if tournament is now complete.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament  DB tournament row
 * @param {string} userId      Discord user ID of the player to DQ
 * @param {string} reason      Reason for disqualification
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function disqualifyPlayer(
  guild,
  tournament,
  userId,
  reason = "Disqualified by admin",
) {
  // ── Validate participant ───────────────────────────────────
  const participant = getParticipant(tournament.id, userId);
  if (!participant) {
    return {
      success: false,
      message: "❌ This user is not a participant in the tournament.",
    };
  }

  if (participant.status === PARTICIPANT_STATUS.DISQUALIFIED) {
    return { success: false, message: "❌ This user is already disqualified." };
  }

  if (participant.role !== "participant") {
    return {
      success: false,
      message: "❌ This user is a spectator, not a participant.",
    };
  }

  // ── Validate tournament status ─────────────────────────────
  if (tournament.status !== TOURNAMENT_STATUS.IN_PROGRESS) {
    return {
      success: false,
      message:
        "❌ Disqualification is only available during an active tournament.",
    };
  }

  try {
    // ── 1. Mark as disqualified ──────────────────────────────
    updateParticipantStatus(
      tournament.id,
      userId,
      PARTICIPANT_STATUS.DISQUALIFIED,
    );

    // ── 2. Resolve all their unfinished matches ──────────────
    const resolvedMatches = await resolvePlayerMatches(
      guild,
      tournament,
      userId,
    );

    // ── 3. Remove participant role ───────────────────────────
    await removeParticipantRole(guild, tournament, userId);

    // ── 4. Post notice ───────────────────────────────────────
    const playerName = participant.display_name || participant.username;
    await sendTournamentNotice(
      guild,
      tournament,
      new EmbedBuilder()
        .setTitle("⛔ Player Disqualified")
        .setColor(COLORS.DANGER)
        .setDescription(
          `**${playerName}** (<@${userId}>) has been disqualified from **${tournament.name}**.\n\n` +
            `📝 **Reason:** ${reason}\n` +
            `⚔️ **Matches affected:** ${resolvedMatches.length}\n\n` +
            `All their remaining matches have been awarded to opponents.`,
        )
        .setTimestamp(),
    );

    // ── 5. DM the disqualified player ────────────────────────
    await dmDisqualifiedPlayer(guild, tournament, userId, reason);

    // ── 6. Refresh embeds ────────────────────────────────────
    const fresh = getTournamentById(tournament.id);
    await refreshLeaderboard(guild, fresh);
    await refreshParticipationList(guild, fresh);
    await refreshAdminPanel(guild, fresh);

    // ── 7. Check if tournament is now complete ───────────────
    const tournamentDone = isTournamentComplete(tournament.id);

    if (tournamentDone) {
      await autoCompleteTournament(guild, fresh);
    } else {
      // ── 8. Launch newly available matches ──────────────────
      await launchAvailableMatches(guild, fresh);
    }

    console.log(
      `[DQ] Disqualified "${playerName}" from "${tournament.name}" — ${resolvedMatches.length} matches resolved`,
    );

    return {
      success: true,
      message:
        `✅ **${playerName}** has been disqualified.\n\n` +
        `⚔️ **${resolvedMatches.length}** match(es) resolved.\n` +
        `All opponents awarded wins automatically.`,
    };
  } catch (err) {
    console.error("[DQ] Disqualification failed:", err);
    return {
      success: false,
      message: `❌ Disqualification failed: ${err.message}`,
    };
  }
}

// ═════════════════════════════════════════════════════════════════
//  RESOLVE ALL UNFINISHED MATCHES FOR A PLAYER
// ═════════════════════════════════════════════════════════════════

/**
 * For each pending or in-progress match involving the DQ'd player:
 *   - Set winner = opponent, loser = DQ'd player
 *   - Set status = completed
 *   - Give opponent +3 points, +1 win
 *   - Give DQ'd player +1 loss
 *   - Update thread embed if it exists
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament
 * @param {string} dqUserId
 * @returns {Promise<object[]>} Array of resolved match rows
 */
async function resolvePlayerMatches(guild, tournament, dqUserId) {
  const allMatches = getMatchesByPlayer(tournament.id, dqUserId);
  const resolved = [];

  for (const match of allMatches) {
    // Skip already completed or cancelled matches
    if (match.status === "completed" || match.status === "cancelled") {
      continue;
    }

    // Determine the opponent
    const opponentId =
      match.player1_id === dqUserId ? match.player2_id : match.player1_id;

    // If opponent is null (shouldn't happen in round-robin, but safety)
    if (!opponentId) {
      updateMatchStatus(match.id, "cancelled");
      continue;
    }

    // Determine scores — give opponent a default win
    const p1Score = match.player1_id === opponentId ? 1 : 0;
    const p2Score = match.player2_id === opponentId ? 1 : 0;

    // Complete the match with opponent as winner
    updateMatchResult(match.id, {
      winnerId: opponentId,
      loserId: dqUserId,
      player1Score: p1Score,
      player2Score: p2Score,
    });

    // Award stats to opponent (only if they haven't been counted for this match yet)
    // Since match was pending/in_progress, stats haven't been awarded
    incrementParticipantStats(tournament.id, opponentId, {
      pointsDelta: POINTS.WIN,
      winsDelta: 1,
    });

    // Give DQ'd player a loss
    incrementParticipantStats(tournament.id, dqUserId, {
      pointsDelta: POINTS.LOSS,
      lossesDelta: 1,
    });

    // Get updated match and participant names
    const updatedMatch = getMatchById(match.id);
    const opponentData = getParticipant(tournament.id, opponentId);
    const opponentName =
      opponentData?.display_name || opponentData?.username || "Opponent";

    // Update thread embed if thread exists
    if (match.thread_id) {
      try {
        await updateMatchThreadEmbed(
          guild,
          tournament,
          updatedMatch,
          true,
          `${opponentName} (opponent DQ'd)`,
        );
      } catch {
        // Thread may be archived or deleted
      }
    }

    // DM opponent about the free win
    await dmOpponentDqWin(guild, tournament, opponentId, match);

    resolved.push(updatedMatch);
  }

  return resolved;
}

// ═════════════════════════════════════════════════════════════════
//  ROLE REMOVAL
// ═════════════════════════════════════════════════════════════════

/**
 * Remove the participant role from the DQ'd player.
 */
async function removeParticipantRole(guild, tournament, userId) {
  if (!tournament.participant_role_id) return;

  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.roles.cache.has(tournament.participant_role_id)) {
      await member.roles.remove(
        tournament.participant_role_id,
        `Disqualified from ${tournament.name}`,
      );
    }
  } catch (err) {
    console.warn("[DQ] Could not remove participant role:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  DM NOTIFICATIONS
// ═════════════════════════════════════════════════════════════════

/**
 * DM the disqualified player about their DQ.
 */
async function dmDisqualifiedPlayer(guild, tournament, userId, reason) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("⛔ You Have Been Disqualified")
          .setColor(COLORS.DANGER)
          .setDescription(
            `You have been disqualified from **${tournament.name}**.\n\n` +
              `📝 **Reason:** ${reason}\n\n` +
              `All your remaining matches have been forfeited.\n` +
              `If you believe this was a mistake, contact the tournament organiser.`,
          )
          .setFooter({ text: guild.name })
          .setTimestamp(),
      ],
    });
  } catch {
    // DMs disabled
  }
}

/**
 * DM an opponent that they received a free win due to opponent DQ.
 */
async function dmOpponentDqWin(guild, tournament, opponentId, match) {
  try {
    const member = await guild.members.fetch(opponentId).catch(() => null);
    if (!member) return;

    const dqPlayerId =
      match.player1_id === opponentId ? match.player2_id : match.player1_id;
    const dqPlayerData = getParticipant(tournament.id, dqPlayerId);
    const dqPlayerName =
      dqPlayerData?.display_name || dqPlayerData?.username || "Your opponent";

    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Match Won — Opponent Disqualified")
          .setColor(COLORS.SUCCESS)
          .setDescription(
            `Your opponent **${dqPlayerName}** was disqualified from **${tournament.name}**.\n\n` +
              `🔄 **Round:** ${match.round} · **Match #:** ${match.match_number}\n` +
              `⭐ **+${POINTS.WIN} points** awarded automatically.\n\n` +
              `Stay tuned for your next match!`,
          )
          .setFooter({ text: guild.name })
          .setTimestamp(),
      ],
    });
  } catch {
    // DMs disabled
  }
}

// ═════════════════════════════════════════════════════════════════
//  AUTO-COMPLETE TOURNAMENT AFTER DQ
// ═════════════════════════════════════════════════════════════════

/**
 * If DQ caused all remaining matches to resolve, complete the tournament.
 * Mirrors the logic in matchService.completeTournament but avoids circular import.
 */
async function autoCompleteTournament(guild, tournament) {
  const { updateTournamentStatus: updateStatus } =
    await import("../database/queries.js");

  updateStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh = getTournamentById(tournament.id);
  const leaderboard = getLeaderboard(tournament.id);
  const completed = getCompletedMatchCount(tournament.id);
  const total = getTotalMatchCount(tournament.id);

  await refreshLeaderboard(guild, fresh);

  const resultsEmbed = new EmbedBuilder()
    .setTitle(`🏆 Tournament Complete — ${fresh.name}`)
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  if (leaderboard.length === 0) {
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
        name: "🏆 Champion",
        value: `<@${winner.user_id}> with **${winner.points}** points!`,
      });
    }
  }

  await sendTournamentNotice(guild, fresh, resultsEmbed);
  await refreshAdminPanel(guild, fresh);

  // DM all active participants
  const participants = getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank = leaderboard.findIndex((l) => l.user_id === p.user_id) + 1;
    const medals = ["🥇", "🥈", "🥉"];
    const medal = rank <= 3 ? medals[rank - 1] : "";

    try {
      const member = await guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${medal} Tournament Complete — ${fresh.name}`)
              .setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO)
              .setDescription(
                `**${fresh.name}** has ended!\n\n` +
                  `🏅 **Rank:** #${rank}\n` +
                  `⭐ **Points:** ${p.points}\n` +
                  `✅ **Wins:** ${p.wins} · ❌ **Losses:** ${p.losses}\n` +
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

  console.log(`[TOURNAMENT] "${fresh.name}" completed after disqualification`);
}
