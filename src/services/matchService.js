// ─── src/services/matchService.js ────────────────────────────────
// Match scheduling, round-robin generation, and post-match processing.

import { EmbedBuilder } from "discord.js";
import {
  getTournamentById,
  getMatchById,
  getParticipant,
  getActiveParticipants,
  getLeaderboard,
  getMatchesByRound,
  getCompletedMatchCount,
  getTotalMatchCount,
  getAllAvailableMatches,
  getCurrentRound,
  incrementParticipantStats,
  updateTournamentRound,
  updateTournamentStatus,
  isTournamentComplete,
  isRoundComplete,
} from "../database/queries.js";
import { COLORS, POINTS, TOURNAMENT_STATUS } from "../config.js";
import {
  refreshAdminPanel,
  sendTournamentNotice,
  launchAvailableMatches,
  refreshLeaderboard,
  refreshBracket,
} from "./tournamentService.js";
import { createMatchThreads } from "./threadService.js";

// ═════════════════════════════════════════════════════════════════
//  ROUND-ROBIN SCHEDULE GENERATION
// ═════════════════════════════════════════════════════════════════

/**
 * Fisher-Yates shuffle (in-place on a copy).
 * @param {any[]} arr
 * @returns {any[]}
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a full round-robin schedule using the "circle method".
 *
 * @param {string[]} playerIds  Array of Discord user IDs.
 * @param {boolean}  shuffle    Randomise player order first (default true).
 * @returns {{ totalRounds: number, matches: object[] }}
 */
export function generateRoundRobinSchedule(playerIds, shuffle = true) {
  const players = shuffle ? shuffleArray(playerIds) : [...playerIds];
  const isOdd = players.length % 2 !== 0;

  if (isOdd) {
    players.push(null); // BYE placeholder
  }

  const n = players.length;
  const totalRounds = n - 1;
  const halfSize = n / 2;

  const fixed = players[0];
  const rotating = players.slice(1);

  const schedule = [];
  let matchNumber = 1;

  for (let round = 0; round < totalRounds; round++) {
    const opponent = rotating[rotating.length - 1];
    if (fixed !== null && opponent !== null) {
      schedule.push({
        round: round + 1,
        matchNumber: matchNumber++,
        player1Id: fixed,
        player2Id: opponent,
      });
    }

    for (let i = 0; i < halfSize - 1; i++) {
      const p1 = rotating[i];
      const p2 = rotating[rotating.length - 2 - i];
      if (p1 !== null && p2 !== null) {
        schedule.push({
          round: round + 1,
          matchNumber: matchNumber++,
          player1Id: p1,
          player2Id: p2,
        });
      }
    }

    rotating.unshift(rotating.pop());
  }

  return { totalRounds, matches: schedule };
}

// ═════════════════════════════════════════════════════════════════
//  POST-MATCH PROCESSING
// ═════════════════════════════════════════════════════════════════

/**
 * Process everything that should happen after a match completes:
 *
 *  1. Update participant stats (points, wins, losses).
 *  2. Refresh leaderboard.
 *  3. Post result in the result channel.
 *  4. DM players about the result.
 *  5. Update round tracking.
 *  6. Launch next available matches.
 *  7. Check if tournament is complete.
 *  8. Refresh admin panel.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament   DB tournament row
 * @param {object} match        DB match row (already marked completed)
 */
export async function processMatchCompletion(guild, tournament, match) {
  try {
    // ── 1. Update participant stats ────────────────────────────
    updatePlayerStats(match);

    // ── 2. Refresh leaderboard ─────────────────────────────────
    const freshForLeaderboard = getTournamentById(tournament.id);
    await refreshLeaderboard(guild, freshForLeaderboard);

    // ── 3. Refresh bracket ─────────────────────────────────────
    await refreshBracket(guild, freshForLeaderboard);

    // ── 4. Post result in result channel ───────────────────────
    await postMatchResult(guild, tournament, match);

    // ── 5. DM players about the result ─────────────────────────
    await dmMatchResult(guild, tournament, match);

    // ── 6. Update round tracking ───────────────────────────────
    await updateRoundTracking(guild, tournament, match);

    // ── 7. Check if entire tournament is complete ──────────────
    const tournamentDone = isTournamentComplete(tournament.id);

    if (tournamentDone) {
      await completeTournament(guild, tournament);
    } else {
      // ── 8. Launch next available matches ─────────────────────
      const freshTournament = getTournamentById(tournament.id);
      await launchAvailableMatches(guild, freshTournament);

      // ── 9. Refresh admin panel ───────────────────────────────
      await refreshAdminPanel(guild, freshTournament);
    }

    console.log(
      `[MATCH] Post-match processing complete for Match #${match.match_number} (R${match.round})`,
    );
  } catch (err) {
    console.error(
      `[MATCH] Post-match processing failed for match ${match.id}:`,
      err,
    );
  }
}

// ═════════════════════════════════════════════════════════════════
//  1. UPDATE PLAYER STATS
// ═════════════════════════════════════════════════════════════════

/**
 * Increment wins/losses/points for both players based on the match result.
 * @param {object} match  Completed match row
 */
function updatePlayerStats(match) {
  const { tournament_id, winner_id, loser_id, player1_id, player2_id } = match;

  // Determine if it was a draw (shouldn't happen with odd best_of, but safe)
  const isDraw = !winner_id;

  if (isDraw) {
    incrementParticipantStats(tournament_id, player1_id, {
      pointsDelta: POINTS.DRAW,
      drawsDelta: 1,
    });
    incrementParticipantStats(tournament_id, player2_id, {
      pointsDelta: POINTS.DRAW,
      drawsDelta: 1,
    });
  } else {
    // Winner
    incrementParticipantStats(tournament_id, winner_id, {
      pointsDelta: POINTS.WIN,
      winsDelta: 1,
    });
    // Loser
    incrementParticipantStats(tournament_id, loser_id, {
      pointsDelta: POINTS.LOSS,
      lossesDelta: 1,
    });
  }

  console.log(
    `[STATS] Updated stats for match ${match.id}: winner=${winner_id}, loser=${loser_id}`,
  );
}

// ═════════════════════════════════════════════════════════════════
//  2. POST RESULT IN RESULT CHANNEL
// ═════════════════════════════════════════════════════════════════

/**
 * Send a result embed to the tournament's result channel.
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament
 * @param {object} match
 */
async function postMatchResult(guild, tournament, match) {
  if (!tournament.result_channel_id) return;

  try {
    const channel = await guild.channels.fetch(tournament.result_channel_id);
    if (!channel) return;

    const p1Data = getParticipant(tournament.id, match.player1_id);
    const p2Data = getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || "Player 1";
    const p2Name = p2Data?.display_name || p2Data?.username || "Player 2";

    const winnerName = match.winner_id === match.player1_id ? p1Name : p2Name;
    const loserName = match.winner_id === match.player1_id ? p2Name : p1Name;

    const completed = getCompletedMatchCount(tournament.id);
    const total = getTotalMatchCount(tournament.id);

    const embed = new EmbedBuilder()
      .setTitle(
        `📋 Match Result — Round ${match.round}, Match #${match.match_number}`,
      )
      .setColor(COLORS.SUCCESS)
      .addFields(
        {
          name: "🏆 Winner",
          value: `**${winnerName}** (<@${match.winner_id}>)`,
          inline: true,
        },
        {
          name: "💀 Loser",
          value: `${loserName} (<@${match.loser_id}>)`,
          inline: true,
        },
        {
          name: "📊 Score",
          value: `${p1Name} **${match.player1_score}** — **${match.player2_score}** ${p2Name}`,
          inline: false,
        },
        {
          name: "📈 Progress",
          value: `${completed} / ${total} matches completed`,
          inline: false,
        },
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn("[RESULT] Could not post match result:", err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  3. DM PLAYERS ABOUT RESULT
// ═════════════════════════════════════════════════════════════════

/**
 * DM both players about the match result.
 */
async function dmMatchResult(guild, tournament, match) {
  const p1Data = getParticipant(tournament.id, match.player1_id);
  const p2Data = getParticipant(tournament.id, match.player2_id);
  const p1Name = p1Data?.display_name || p1Data?.username || "Player 1";
  const p2Name = p2Data?.display_name || p2Data?.username || "Player 2";

  const scoreStr = `${p1Name} **${match.player1_score}** — **${match.player2_score}** ${p2Name}`;

  // DM winner
  await dmUser(
    guild,
    match.winner_id,
    new EmbedBuilder()
      .setTitle("🏆 You Won!")
      .setColor(COLORS.SUCCESS)
      .setDescription(
        `Congratulations! You won your match in **${tournament.name}**!\n\n` +
          `📊 **Score:** ${scoreStr}\n` +
          `🔄 **Round:** ${match.round}\n\n` +
          `+**${POINTS.WIN}** points awarded. Stay tuned for your next match!`,
      )
      .setFooter({ text: guild.name })
      .setTimestamp(),
  );

  // DM loser
  await dmUser(
    guild,
    match.loser_id,
    new EmbedBuilder()
      .setTitle("💀 Match Lost")
      .setColor(COLORS.DANGER)
      .setDescription(
        `You lost your match in **${tournament.name}**.\n\n` +
          `📊 **Score:** ${scoreStr}\n` +
          `🔄 **Round:** ${match.round}\n\n` +
          `Don't give up! More matches may be coming.`,
      )
      .setFooter({ text: guild.name })
      .setTimestamp(),
  );
}

/**
 * Send a DM embed to a user. Silently fails if DMs are disabled.
 */
async function dmUser(guild, userId, embed) {
  try {
    const member = await guild.members.fetch(userId);
    if (member) await member.send({ embeds: [embed] });
  } catch {
    // DMs disabled — not critical
  }
}

// ═════════════════════════════════════════════════════════════════
//  4. UPDATE ROUND TRACKING
// ═════════════════════════════════════════════════════════════════

/**
 * Check if the current round is complete; if so advance current_round
 * and send a round-completion notice.
 */
async function updateRoundTracking(guild, tournament, match) {
  const roundDone = isRoundComplete(tournament.id, match.round);

  if (!roundDone) return;

  // Advance current_round
  const newRound = match.round + 1;
  const freshTournament = getTournamentById(tournament.id);
  const totalRounds = freshTournament.total_rounds;

  if (newRound <= totalRounds) {
    updateTournamentRound(tournament.id, newRound, totalRounds);

    // Send round completion notice
    const leaderboard = getLeaderboard(tournament.id);
    const top3 = leaderboard.slice(0, 3);
    const medals = ["🥇", "🥈", "🥉"];

    let standings = "";
    for (let i = 0; i < top3.length; i++) {
      const p = top3[i];
      standings += `${medals[i]} <@${p.user_id}> — ${p.points} pts (${p.wins}W/${p.losses}L)\n`;
    }

    await sendTournamentNotice(
      guild,
      freshTournament,
      new EmbedBuilder()
        .setTitle(`🔄 Round ${match.round} Complete!`)
        .setColor(COLORS.INFO)
        .setDescription(
          `All matches in **Round ${match.round}** are finished.\n\n` +
            `**Current Standings (Top 3):**\n${standings}\n` +
            `Starting **Round ${newRound}** of ${totalRounds}…`,
        )
        .setTimestamp(),
    );

    console.log(
      `[ROUND] Round ${match.round} complete for "${tournament.name}" — advancing to round ${newRound}`,
    );
  } else {
    // This was the last round — tournament will be completed by the caller
    updateTournamentRound(tournament.id, totalRounds, totalRounds);
    console.log(
      `[ROUND] Final round ${match.round} complete for "${tournament.name}"`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════
//  6. TOURNAMENT COMPLETION
// ═════════════════════════════════════════════════════════════════

/**
 * Called when all matches in the tournament are complete.
 * Updates status, posts final standings, refreshes embeds.
 */
async function completeTournament(guild, tournament) {
  updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh = getTournamentById(tournament.id);
  const leaderboard = getLeaderboard(tournament.id);
  const completed = getCompletedMatchCount(tournament.id);
  const total = getTotalMatchCount(tournament.id);

  // ── Final canvas refreshes ─────────────────────────────────
  await refreshLeaderboard(guild, fresh);
  await refreshBracket(guild, fresh);

  // ── Build final results embed ──────────────────────────────
  const resultsEmbed = new EmbedBuilder()
    .setTitle(`🏆 Tournament Complete — ${fresh.name}`)
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
      description += `${prefix} <@${p.user_id}> — ${p.points} pts (${p.wins}W / ${p.losses}L / ${p.draws}D)\n`;
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

  // ── Post & refresh ─────────────────────────────────────────
  await sendTournamentNotice(guild, fresh, resultsEmbed);
  await refreshAdminPanel(guild, fresh);

  // ── DM all participants with final results ─────────────────
  const participants = getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank = leaderboard.findIndex((l) => l.user_id === p.user_id) + 1;
    const medals = ["🥇", "🥈", "🥉"];
    const medal = rank <= 3 ? medals[rank - 1] : "";

    await dmUser(
      guild,
      p.user_id,
      new EmbedBuilder()
        .setTitle(`${medal} Tournament Complete — ${fresh.name}`)
        .setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO)
        .setDescription(
          `**${fresh.name}** has ended!\n\n` +
            `📊 **Your Results:**\n` +
            `🏅 **Rank:** #${rank}\n` +
            `⭐ **Points:** ${p.points}\n` +
            `✅ **Wins:** ${p.wins} · ❌ **Losses:** ${p.losses} · 🤝 **Draws:** ${p.draws}\n` +
            `🎮 **Matches Played:** ${p.matches_played}`,
        )
        .setFooter({ text: guild.name })
        .setTimestamp(),
    );
  }

  console.log(
    `[TOURNAMENT] "${fresh.name}" completed automatically — all matches done`,
  );
}
