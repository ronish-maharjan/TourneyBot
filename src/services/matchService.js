// ─── src/services/matchService.js ────────────────────────────────

import { EmbedBuilder } from 'discord.js';
import {
  getTournamentById,
  getMatchById,
  getParticipant,
  getActiveParticipants,
  getLeaderboard,
  getCompletedMatchCount,
  getTotalMatchCount,
  incrementParticipantStats,
  updateTournamentRound,
  updateTournamentStatus,
  isTournamentComplete,
  isRoundComplete,
} from '../database/queries.js';
import {
  COLORS,
  POINTS,
  TOURNAMENT_STATUS,
} from '../config.js';
import {
  refreshAdminPanel,
  sendTournamentNotice,
  launchAvailableMatches,
  refreshLeaderboard,
  refreshBracket,
} from './tournamentService.js';

// ═════════════════════════════════════════════════════════════════
//  ROUND-ROBIN SCHEDULE GENERATION
// ═════════════════════════════════════════════════════════════════

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function generateRoundRobinSchedule(playerIds, shuffle = true) {
  const players = shuffle ? shuffleArray(playerIds) : [...playerIds];
  const isOdd   = players.length % 2 !== 0;

  if (isOdd) players.push(null);

  const n           = players.length;
  const totalRounds = n - 1;
  const halfSize    = n / 2;
  const fixed       = players[0];
  const rotating    = players.slice(1);
  const schedule    = [];
  let matchNumber   = 1;

  for (let round = 0; round < totalRounds; round++) {
    const opponent = rotating[rotating.length - 1];
    if (fixed !== null && opponent !== null) {
      schedule.push({ round: round + 1, matchNumber: matchNumber++, player1Id: fixed, player2Id: opponent });
    }

    for (let i = 0; i < halfSize - 1; i++) {
      const p1 = rotating[i];
      const p2 = rotating[rotating.length - 2 - i];
      if (p1 !== null && p2 !== null) {
        schedule.push({ round: round + 1, matchNumber: matchNumber++, player1Id: p1, player2Id: p2 });
      }
    }

    rotating.unshift(rotating.pop());
  }

  return { totalRounds, matches: schedule };
}

// ═════════════════════════════════════════════════════════════════
//  POST-MATCH PROCESSING
// ═════════════════════════════════════════════════════════════════

export async function processMatchCompletion(guild, tournament, match) {
  try {
    await updatePlayerStats(match);

    const freshForLeaderboard = await getTournamentById(tournament.id);
    await refreshLeaderboard(guild, freshForLeaderboard);
    await refreshBracket(guild, freshForLeaderboard);

    await postMatchResult(guild, tournament, match);
    await dmMatchResult(guild, tournament, match);
    await updateRoundTracking(guild, tournament, match);

    const tournamentDone = await isTournamentComplete(tournament.id);

    if (tournamentDone) {
      await completeTournament(guild, tournament);
    } else {
      const freshTournament = await getTournamentById(tournament.id);
      await refreshAdminPanel(guild, freshTournament);
    }

    console.log(`[MATCH] Post-match processing complete for Match #${match.match_number} (R${match.round})`);
  } catch (err) {
    console.error(`[MATCH] Post-match processing failed for match ${match.id}:`, err);
  }
}

// ═════════════════════════════════════════════════════════════════
//  1. UPDATE PLAYER STATS
// ═════════════════════════════════════════════════════════════════

async function updatePlayerStats(match) {
  const { tournament_id, winner_id, loser_id, player1_id, player2_id } = match;
  const isDraw = !winner_id;

  if (isDraw) {
    await incrementParticipantStats(tournament_id, player1_id, { pointsDelta: POINTS.DRAW, drawsDelta: 1 });
    await incrementParticipantStats(tournament_id, player2_id, { pointsDelta: POINTS.DRAW, drawsDelta: 1 });
  } else {
    await incrementParticipantStats(tournament_id, winner_id, { pointsDelta: POINTS.WIN, winsDelta: 1 });
    await incrementParticipantStats(tournament_id, loser_id, { pointsDelta: POINTS.LOSS, lossesDelta: 1 });
  }
}

// ═════════════════════════════════════════════════════════════════
//  2. POST RESULT IN RESULT CHANNEL
// ═════════════════════════════════════════════════════════════════

async function postMatchResult(guild, tournament, match) {
  if (!tournament.result_channel_id) return;

  try {
    const channel = await guild.channels.fetch(tournament.result_channel_id);
    if (!channel) return;

    const p1Data = await getParticipant(tournament.id, match.player1_id);
    const p2Data = await getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    const winnerName = match.winner_id === match.player1_id ? p1Name : p2Name;
    const loserName  = match.winner_id === match.player1_id ? p2Name : p1Name;

    const completed = await getCompletedMatchCount(tournament.id);
    const total     = await getTotalMatchCount(tournament.id);

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`📋 Match Result — Round ${match.round}, Match #${match.match_number}`)
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: '🏆 Winner',   value: `**${winnerName}** (<@${match.winner_id}>)`, inline: true },
            { name: '💀 Loser',    value: `${loserName} (<@${match.loser_id}>)`,        inline: true },
            { name: '📊 Score',    value: `${p1Name} **${match.player1_score}** — **${match.player2_score}** ${p2Name}`, inline: false },
            { name: '📈 Progress', value: `${completed} / ${total} matches completed`, inline: false },
          )
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.warn('[RESULT] Could not post match result:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  3. DM PLAYERS ABOUT RESULT
// ═════════════════════════════════════════════════════════════════

async function dmMatchResult(guild, tournament, match) {
  const p1Data = await getParticipant(tournament.id, match.player1_id);
  const p2Data = await getParticipant(tournament.id, match.player2_id);
  const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
  const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

  const scoreStr = `${p1Name} **${match.player1_score}** — **${match.player2_score}** ${p2Name}`;

  await dmUser(guild, match.winner_id, new EmbedBuilder()
    .setTitle('🏆 You Won!')
    .setColor(COLORS.SUCCESS)
    .setDescription(
      `Congratulations! You won your match in **${tournament.name}**!\n\n` +
      `📊 **Score:** ${scoreStr}\n🔄 **Round:** ${match.round}\n\n+**${POINTS.WIN}** points awarded.`,
    )
    .setFooter({ text: guild.name })
    .setTimestamp(),
  );

  await dmUser(guild, match.loser_id, new EmbedBuilder()
    .setTitle('💀 Match Lost')
    .setColor(COLORS.DANGER)
    .setDescription(
      `You lost your match in **${tournament.name}**.\n\n` +
      `📊 **Score:** ${scoreStr}\n🔄 **Round:** ${match.round}\n\nDon't give up!`,
    )
    .setFooter({ text: guild.name })
    .setTimestamp(),
  );
}

async function dmUser(guild, userId, embed) {
  try {
    const member = await guild.members.fetch(userId);
    if (member) await member.send({ embeds: [embed] });
  } catch {}
}

// ═════════════════════════════════════════════════════════════════
//  4. UPDATE ROUND TRACKING + LAUNCH NEXT ROUND
// ═════════════════════════════════════════════════════════════════

async function updateRoundTracking(guild, tournament, match) {
  const roundDone = await isRoundComplete(tournament.id, match.round);

  if (!roundDone) {
    const freshTournament = await getTournamentById(tournament.id);
    const launched = await launchAvailableMatches(guild, freshTournament);
    if (launched > 0) {
      const afterLaunch = await getTournamentById(tournament.id);
      await refreshBracket(guild, afterLaunch);
    }
    return;
  }

  const freshTournament = await getTournamentById(tournament.id);
  const totalRounds     = freshTournament.total_rounds;
  const newRound        = match.round + 1;

  if (newRound <= totalRounds) {
    await updateTournamentRound(tournament.id, newRound, totalRounds);

    const leaderboard = await getLeaderboard(tournament.id);
    const top3        = leaderboard.slice(0, 3);
    const medals      = ['🥇', '🥈', '🥉'];

    let standings = '';
    for (let i = 0; i < top3.length; i++) {
      const p  = top3[i];
      const dq = p.status === 'disqualified' ? ' *(DQ)*' : '';
      standings += `${medals[i]} <@${p.user_id}>${dq} — ${p.points} pts (${p.wins}W/${p.losses}L)\n`;
    }

    await sendTournamentNotice(guild, freshTournament, new EmbedBuilder()
      .setTitle(`🔄 Round ${match.round} Complete!`)
      .setColor(COLORS.INFO)
      .setDescription(
        `All matches in **Round ${match.round}** are finished.\n\n` +
        `**Current Standings (Top 3):**\n${standings}\n` +
        `Starting **Round ${newRound}** of ${totalRounds}…\n` +
        `Match threads will appear shortly in <#${freshTournament.match_channel_id}>.`,
      )
      .setTimestamp(),
    );

    console.log(`[ROUND] Round ${match.round} complete — launching Round ${newRound}`);

    const updatedTournament = await getTournamentById(tournament.id);
    await launchAvailableMatches(guild, updatedTournament);

    const afterLaunch = await getTournamentById(tournament.id);
    await refreshBracket(guild, afterLaunch);

  } else {
    await updateTournamentRound(tournament.id, totalRounds, totalRounds);
    console.log(`[ROUND] Final round ${match.round} complete`);
  }
}

// ═════════════════════════════════════════════════════════════════
//  6. TOURNAMENT COMPLETION
// ═════════════════════════════════════════════════════════════════

async function completeTournament(guild, tournament) {
  await updateTournamentStatus(tournament.id, TOURNAMENT_STATUS.COMPLETED);

  const fresh       = await getTournamentById(tournament.id);
  const leaderboard = await getLeaderboard(tournament.id);
  const completed   = await getCompletedMatchCount(tournament.id);
  const total       = await getTotalMatchCount(tournament.id);

  await refreshLeaderboard(guild, fresh);
  await refreshBracket(guild, fresh);

  const resultsEmbed = new EmbedBuilder()
    .setTitle(`🏆 Tournament Complete — ${fresh.name}`)
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
    resultsEmbed.addFields({ name: 'Matches Played', value: `${completed} / ${total}`, inline: true });

    if (leaderboard.length > 0) {
      resultsEmbed.addFields({ name: '🏆 Champion', value: `<@${leaderboard[0].user_id}> with **${leaderboard[0].points}** points!` });
    }
  }

  await sendTournamentNotice(guild, fresh, resultsEmbed, true);
  await refreshAdminPanel(guild, fresh);

  const participants = await getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank  = leaderboard.findIndex(l => l.user_id === p.user_id) + 1;
    const medals = ['🥇', '🥈', '🥉'];
    const medal  = rank > 0 && rank <= 3 ? medals[rank - 1] : '';

    await dmUser(guild, p.user_id, new EmbedBuilder()
      .setTitle(`${medal} Tournament Complete — ${fresh.name}`)
      .setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO)
      .setDescription(
        `**${fresh.name}** has ended!\n\n🏅 **Rank:** #${rank}\n⭐ **Points:** ${p.points}\n` +
        `✅ **Wins:** ${p.wins} · ❌ **Losses:** ${p.losses} · 🤝 **Draws:** ${p.draws}\n🎮 **Matches Played:** ${p.matches_played}`,
      )
      .setFooter({ text: guild.name })
      .setTimestamp(),
    );
  }

  console.log(`[TOURNAMENT] "${fresh.name}" completed automatically`);
}
