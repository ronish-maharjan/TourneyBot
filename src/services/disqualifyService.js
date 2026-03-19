// ─── src/services/disqualifyService.js ───────────────────────────

import { EmbedBuilder } from 'discord.js';
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
  updateTournamentStatus,
} from '../database/queries.js';
import { COLORS, POINTS, PARTICIPANT_STATUS, TOURNAMENT_STATUS } from '../config.js';
import {
  refreshAdminPanel,
  refreshLeaderboard,
  refreshBracket,
  refreshParticipationList,
  sendTournamentNotice,
  launchAvailableMatches,
} from './tournamentService.js';
import { updateMatchThreadEmbed, markThreadCancelled } from './threadService.js';
import { acquireLock, releaseLock } from './lockService.js';

export async function disqualifyPlayer(guild, tournament, userId, reason = 'Disqualified by admin') {
  if (!acquireLock(`dq_${userId}`)) {
    return { success: false, message: '⏳ This player is already being processed for disqualification.' };
  }

  try {
    const participant = await getParticipant(tournament.id, userId);
    if (!participant) return { success: false, message: '❌ This user is not a participant.' };
    if (participant.status === PARTICIPANT_STATUS.DISQUALIFIED) return { success: false, message: '❌ Already disqualified.' };
    if (participant.role !== 'participant') return { success: false, message: '❌ This user is a spectator.' };
    if (tournament.status !== TOURNAMENT_STATUS.IN_PROGRESS) return { success: false, message: '❌ Only available during active tournament.' };

    await updateParticipantStatus(tournament.id, userId, PARTICIPANT_STATUS.DISQUALIFIED);

    const resolvedMatches = await resolvePlayerMatches(guild, tournament, userId);
    await removeParticipantRole(guild, tournament, userId);

    const playerName = participant.display_name || participant.username;
    await sendTournamentNotice(guild, tournament, new EmbedBuilder()
      .setTitle('⛔ Player Disqualified')
      .setColor(COLORS.DANGER)
      .setDescription(
        `**${playerName}** (<@${userId}>) has been disqualified from **${tournament.name}**.\n\n` +
        `📝 **Reason:** ${reason}\n⚔️ **Matches affected:** ${resolvedMatches.length}\n\n` +
        `All remaining matches awarded to opponents.`,
      )
      .setTimestamp(),
    );

    await dmDisqualifiedPlayer(guild, tournament, userId, reason);

    const fresh = await getTournamentById(tournament.id);
    await refreshLeaderboard(guild, fresh);
    await refreshBracket(guild, fresh);
    await refreshParticipationList(guild, fresh);
    await refreshAdminPanel(guild, fresh);

    const tournamentDone = await isTournamentComplete(tournament.id);
    if (tournamentDone) {
      await autoCompleteTournament(guild, fresh);
    } else {
      await launchAvailableMatches(guild, fresh);
    }

    console.log(`[DQ] Disqualified "${playerName}" — ${resolvedMatches.length} matches resolved`);
    return { success: true, message: `✅ **${playerName}** disqualified.\n⚔️ **${resolvedMatches.length}** match(es) resolved.` };

  } catch (err) {
    console.error('[DQ] Failed:', err);
    return { success: false, message: `❌ Failed: ${err.message}` };
  } finally {
    releaseLock(`dq_${userId}`);
  }
}

async function resolvePlayerMatches(guild, tournament, dqUserId) {
  const allMatches = await getMatchesByPlayer(tournament.id, dqUserId);
  const resolved   = [];

  for (const match of allMatches) {
    if (match.status === 'completed' || match.status === 'cancelled') continue;

    const opponentId = match.player1_id === dqUserId ? match.player2_id : match.player1_id;

    if (!opponentId) {
      await updateMatchStatus(match.id, 'cancelled');
      continue;
    }

    const p1Score = match.player1_id === opponentId ? 1 : 0;
    const p2Score = match.player2_id === opponentId ? 1 : 0;

    await updateMatchResult(match.id, { winnerId: opponentId, loserId: dqUserId, player1Score: p1Score, player2Score: p2Score });
    await incrementParticipantStats(tournament.id, opponentId, { pointsDelta: POINTS.WIN, winsDelta: 1 });
    await incrementParticipantStats(tournament.id, dqUserId, { pointsDelta: POINTS.LOSS, lossesDelta: 1 });

    const updatedMatch = await getMatchById(match.id);
    const opponentData = await getParticipant(tournament.id, opponentId);
    const opponentName = opponentData?.display_name || opponentData?.username || 'Opponent';

    if (match.thread_id) {
      if (match.status === 'in_progress') {
        try { await updateMatchThreadEmbed(guild, tournament, updatedMatch, true, `${opponentName} (opponent DQ'd)`); } catch {}
      } else {
        try { await markThreadCancelled(guild, updatedMatch); } catch {}
      }
    }

    await dmOpponentDqWin(guild, tournament, opponentId, match);
    resolved.push(updatedMatch);
  }

  return resolved;
}

async function removeParticipantRole(guild, tournament, userId) {
  if (!tournament.participant_role_id) return;
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.roles.cache.has(tournament.participant_role_id)) {
      await member.roles.remove(tournament.participant_role_id);
    }
  } catch {}
}

async function dmDisqualifiedPlayer(guild, tournament, userId, reason) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('⛔ You Have Been Disqualified')
          .setColor(COLORS.DANGER)
          .setDescription(`You have been disqualified from **${tournament.name}**.\n\n📝 **Reason:** ${reason}\n\nAll remaining matches forfeited.`)
          .setFooter({ text: guild.name })
          .setTimestamp(),
      ],
    });
  } catch {}
}

async function dmOpponentDqWin(guild, tournament, opponentId, match) {
  try {
    const member = await guild.members.fetch(opponentId).catch(() => null);
    if (!member) return;
    const dqPlayerId   = match.player1_id === opponentId ? match.player2_id : match.player1_id;
    const dqPlayerData = await getParticipant(tournament.id, dqPlayerId);
    const dqPlayerName = dqPlayerData?.display_name || dqPlayerData?.username || 'Opponent';

    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 Match Won — Opponent Disqualified')
          .setColor(COLORS.SUCCESS)
          .setDescription(`**${dqPlayerName}** was disqualified. +**${POINTS.WIN}** points awarded.`)
          .setFooter({ text: guild.name })
          .setTimestamp(),
      ],
    });
  } catch {}
}

async function autoCompleteTournament(guild, tournament) {
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

  if (leaderboard.length === 0) {
    resultsEmbed.setDescription('No completed matches.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    let description = '**Final Standings:**\n\n';
    const top = leaderboard.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
      const dqTag  = p.status === 'disqualified' ? ' *(DQ)*' : '';
      description += `${prefix} <@${p.user_id}>${dqTag} — ${p.points} pts (${p.wins}W / ${p.losses}L)\n`;
    }
    resultsEmbed.setDescription(description);
    resultsEmbed.addFields({ name: 'Matches', value: `${completed} / ${total}`, inline: true });
    if (leaderboard.length > 0) resultsEmbed.addFields({ name: '🏆 Champion', value: `<@${leaderboard[0].user_id}> with **${leaderboard[0].points}** pts!` });
  }

  await sendTournamentNotice(guild, fresh, resultsEmbed, true);
  await refreshAdminPanel(guild, fresh);

  const participants = await getActiveParticipants(tournament.id);
  for (const p of participants) {
    const rank = leaderboard.findIndex(l => l.user_id === p.user_id) + 1;
    const medal = rank > 0 && rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : '';
    try {
      const member = await guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        await member.send({
          embeds: [new EmbedBuilder()
            .setTitle(`${medal} Tournament Complete — ${fresh.name}`)
            .setColor(rank === 1 ? COLORS.SUCCESS : COLORS.INFO)
            .setDescription(`**${fresh.name}** has ended!\n\n🏅 **Rank:** #${rank}\n⭐ **Points:** ${p.points}\n✅ ${p.wins}W · ❌ ${p.losses}L\n🎮 ${p.matches_played} played`)
            .setFooter({ text: guild.name }).setTimestamp()],
        });
      }
    } catch {}
  }

  console.log(`[TOURNAMENT] "${fresh.name}" completed after DQ`);
}
