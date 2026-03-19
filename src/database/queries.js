// ─── src/database/queries.js ─────────────────────────────────────
// All database queries. Every function is async (PostgreSQL).

import { getPool } from './init.js';

// Helper: single row
async function queryOne(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows[0] || undefined;
}

// Helper: all rows
async function queryAll(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

// Helper: execute (returns rowCount)
async function execute(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result;
}

// ═════════════════════════════════════════════════════════════════
//  TOURNAMENT QUERIES
// ═════════════════════════════════════════════════════════════════

export async function createTournament({ id, guildId, name, createdBy }) {
  return execute(
    'INSERT INTO tournaments (id, guild_id, name, created_by) VALUES ($1, $2, $3, $4)',
    [id, guildId, name, createdBy]
  );
}

export async function getTournamentById(id) {
  return queryOne('SELECT * FROM tournaments WHERE id = $1', [id]);
}

export async function getTournamentByChannelId(channelId) {
  return queryOne(`
    SELECT * FROM tournaments
    WHERE category_id = $1 OR leaderboard_channel_id = $1 OR admin_channel_id = $1
       OR notice_channel_id = $1 OR registration_channel_id = $1 OR participation_channel_id = $1
       OR bracket_channel_id = $1 OR result_channel_id = $1 OR chat_channel_id = $1
       OR match_channel_id = $1 OR rules_channel_id = $1
  `, [channelId]);
}

export async function getTournamentsByGuild(guildId) {
  return queryAll(
    'SELECT * FROM tournaments WHERE guild_id = $1 ORDER BY created_at DESC',
    [guildId]
  );
}

export async function getActiveTournamentsByGuild(guildId) {
  return queryAll(
    "SELECT * FROM tournaments WHERE guild_id = $1 AND status NOT IN ('completed', 'cancelled') ORDER BY created_at DESC",
    [guildId]
  );
}

export async function updateTournamentConfig(id, { name, maxPlayers, teamSize, bestOf, rules }) {
  return execute(
    'UPDATE tournaments SET name = $1, max_players = $2, team_size = $3, best_of = $4, rules = $5 WHERE id = $6',
    [name, maxPlayers, teamSize, bestOf, rules ?? '', id]
  );
}

export async function updateTournamentStatus(id, status) {
  return execute('UPDATE tournaments SET status = $1 WHERE id = $2', [status, id]);
}

export async function updateTournamentChannels(id, {
  categoryId, leaderboardChannelId, adminChannelId, noticeChannelId,
  registrationChannelId, participationChannelId, bracketChannelId,
  resultChannelId, chatChannelId, matchChannelId, rulesChannelId,
}) {
  return execute(`
    UPDATE tournaments SET
      category_id=$1, leaderboard_channel_id=$2, admin_channel_id=$3,
      notice_channel_id=$4, registration_channel_id=$5, participation_channel_id=$6,
      bracket_channel_id=$7, result_channel_id=$8, chat_channel_id=$9,
      match_channel_id=$10, rules_channel_id=$11
    WHERE id = $12
  `, [categoryId, leaderboardChannelId, adminChannelId, noticeChannelId,
      registrationChannelId, participationChannelId, bracketChannelId,
      resultChannelId, chatChannelId, matchChannelId, rulesChannelId, id]);
}

export async function updateTournamentRoles(id, { organizerRoleId, participantRoleId, spectatorRoleId }) {
  return execute(
    'UPDATE tournaments SET organizer_role_id=$1, participant_role_id=$2, spectator_role_id=$3 WHERE id=$4',
    [organizerRoleId, participantRoleId, spectatorRoleId, id]
  );
}

const VALID_MESSAGE_FIELDS = new Set([
  'leaderboard_message_id', 'bracket_message_id', 'participation_message_id',
  'admin_message_id', 'registration_message_id', 'rules_message_id',
]);

export async function updateTournamentMessageId(id, field, messageId) {
  if (!VALID_MESSAGE_FIELDS.has(field)) throw new Error(`Invalid message field: ${field}`);
  return execute(`UPDATE tournaments SET ${field} = $1 WHERE id = $2`, [messageId, id]);
}

export async function updateTournamentRound(id, currentRound, totalRounds) {
  return execute(
    'UPDATE tournaments SET current_round = $1, total_rounds = $2 WHERE id = $3',
    [currentRound, totalRounds, id]
  );
}

export async function deleteTournament(id) {
  return execute('DELETE FROM tournaments WHERE id = $1', [id]);
}

// ═════════════════════════════════════════════════════════════════
//  PARTICIPANT QUERIES
// ═════════════════════════════════════════════════════════════════

export async function addParticipant({ tournamentId, userId, username, displayName, role = 'participant' }) {
  return execute(
    'INSERT INTO participants (tournament_id, user_id, username, display_name, role) VALUES ($1, $2, $3, $4, $5)',
    [tournamentId, userId, username, displayName, role]
  );
}

export async function removeParticipant(tournamentId, userId) {
  return execute(
    'DELETE FROM participants WHERE tournament_id = $1 AND user_id = $2',
    [tournamentId, userId]
  );
}

export async function getParticipant(tournamentId, userId) {
  return queryOne(
    'SELECT * FROM participants WHERE tournament_id = $1 AND user_id = $2',
    [tournamentId, userId]
  );
}

export async function getParticipantsByTournament(tournamentId) {
  return queryAll(
    'SELECT * FROM participants WHERE tournament_id = $1 ORDER BY points DESC, wins DESC, username ASC',
    [tournamentId]
  );
}

export async function getActiveParticipants(tournamentId) {
  return queryAll(
    "SELECT * FROM participants WHERE tournament_id = $1 AND role = 'participant' AND status = 'active' ORDER BY points DESC, wins DESC, username ASC",
    [tournamentId]
  );
}

export async function getActiveParticipantCount(tournamentId) {
  const row = await queryOne(
    "SELECT COUNT(*) as count FROM participants WHERE tournament_id = $1 AND role = 'participant' AND status = 'active'",
    [tournamentId]
  );
  return parseInt(row?.count ?? 0);
}

export async function getParticipantCount(tournamentId) {
  const row = await queryOne(
    "SELECT COUNT(*) as count FROM participants WHERE tournament_id = $1 AND role = 'participant'",
    [tournamentId]
  );
  return parseInt(row?.count ?? 0);
}

export async function getSpectators(tournamentId) {
  return queryAll(
    "SELECT * FROM participants WHERE tournament_id = $1 AND role = 'spectator' ORDER BY username ASC",
    [tournamentId]
  );
}

export async function updateParticipantRole(tournamentId, userId, role) {
  return execute(
    'UPDATE participants SET role = $1 WHERE tournament_id = $2 AND user_id = $3',
    [role, tournamentId, userId]
  );
}

export async function updateParticipantStatus(tournamentId, userId, status) {
  return execute(
    'UPDATE participants SET status = $1 WHERE tournament_id = $2 AND user_id = $3',
    [status, tournamentId, userId]
  );
}

export async function updateParticipantStats(tournamentId, userId, { points, wins, losses, draws, matchesPlayed }) {
  return execute(
    'UPDATE participants SET points=$1, wins=$2, losses=$3, draws=$4, matches_played=$5 WHERE tournament_id=$6 AND user_id=$7',
    [points, wins, losses, draws, matchesPlayed, tournamentId, userId]
  );
}

export async function incrementParticipantStats(tournamentId, userId, { pointsDelta = 0, winsDelta = 0, lossesDelta = 0, drawsDelta = 0 }) {
  return execute(
    'UPDATE participants SET points=points+$1, wins=wins+$2, losses=losses+$3, draws=draws+$4, matches_played=matches_played+1 WHERE tournament_id=$5 AND user_id=$6',
    [pointsDelta, winsDelta, lossesDelta, drawsDelta, tournamentId, userId]
  );
}

export async function getLeaderboard(tournamentId) {
  return queryAll(
    "SELECT * FROM participants WHERE tournament_id = $1 AND role = 'participant' ORDER BY points DESC, wins DESC, losses ASC, username ASC",
    [tournamentId]
  );
}

// ═════════════════════════════════════════════════════════════════
//  MATCH QUERIES
// ═════════════════════════════════════════════════════════════════

export async function createMatch({ tournamentId, round, matchNumber, player1Id, player2Id }) {
  return execute(
    'INSERT INTO matches (tournament_id, round, match_number, player1_id, player2_id) VALUES ($1, $2, $3, $4, $5)',
    [tournamentId, round, matchNumber, player1Id, player2Id]
  );
}

export async function createMatchesBulk(matches) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const m of matches) {
      await client.query(
        'INSERT INTO matches (tournament_id, round, match_number, player1_id, player2_id) VALUES ($1, $2, $3, $4, $5)',
        [m.tournamentId, m.round, m.matchNumber, m.player1Id, m.player2Id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getMatchById(id) {
  return queryOne('SELECT * FROM matches WHERE id = $1', [id]);
}

export async function getMatchesByTournament(tournamentId) {
  return queryAll(
    'SELECT * FROM matches WHERE tournament_id = $1 ORDER BY round, match_number',
    [tournamentId]
  );
}

export async function getMatchesByRound(tournamentId, round) {
  return queryAll(
    'SELECT * FROM matches WHERE tournament_id = $1 AND round = $2 ORDER BY match_number',
    [tournamentId, round]
  );
}

export async function getMatchesByPlayer(tournamentId, userId) {
  return queryAll(
    'SELECT * FROM matches WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2) ORDER BY round, match_number',
    [tournamentId, userId]
  );
}

export async function getActiveMatchByPlayer(tournamentId, userId) {
  return queryOne(
    "SELECT * FROM matches WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'in_progress' LIMIT 1",
    [tournamentId, userId]
  );
}

export async function getPendingMatchesByPlayer(tournamentId, userId) {
  return queryAll(
    "SELECT * FROM matches WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'pending' ORDER BY round, match_number",
    [tournamentId, userId]
  );
}

export async function getAllAvailableMatches(tournamentId) {
  return queryAll(`
    SELECT m.* FROM matches m
    WHERE m.tournament_id = $1 AND m.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM matches m2
        WHERE m2.tournament_id = m.tournament_id AND m2.status = 'in_progress'
          AND (m2.player1_id = m.player1_id OR m2.player2_id = m.player1_id
            OR m2.player1_id = m.player2_id OR m2.player2_id = m.player2_id)
      )
    ORDER BY m.round, m.match_number
  `, [tournamentId]);
}

export async function getAvailableMatchesForRound(tournamentId, round) {
  return queryAll(`
    SELECT m.* FROM matches m
    WHERE m.tournament_id = $1 AND m.round = $2 AND m.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM matches m2
        WHERE m2.tournament_id = m.tournament_id AND m2.status = 'in_progress'
          AND (m2.player1_id = m.player1_id OR m2.player2_id = m.player1_id
            OR m2.player1_id = m.player2_id OR m2.player2_id = m.player2_id)
      )
    ORDER BY m.match_number
  `, [tournamentId, round]);
}

export async function getRemainingMatchCountForRound(tournamentId, round) {
  const row = await queryOne(
    "SELECT COUNT(*) as count FROM matches WHERE tournament_id = $1 AND round = $2 AND status IN ('pending', 'in_progress')",
    [tournamentId, round]
  );
  return parseInt(row?.count ?? 0);
}

export async function updateMatchScore(id, player1Score, player2Score) {
  return execute(
    'UPDATE matches SET player1_score = $1, player2_score = $2 WHERE id = $3',
    [player1Score, player2Score, id]
  );
}

export async function updateMatchResult(id, { winnerId, loserId, player1Score, player2Score }) {
  return execute(
    "UPDATE matches SET winner_id=$1, loser_id=$2, player1_score=$3, player2_score=$4, status='completed', completed_at=NOW() WHERE id=$5",
    [winnerId, loserId, player1Score, player2Score, id]
  );
}

export async function updateMatchStatus(id, status) {
  return execute('UPDATE matches SET status = $1 WHERE id = $2', [status, id]);
}

export async function updateMatchThread(id, threadId, scoreMessageId) {
  return execute(
    'UPDATE matches SET thread_id = $1, score_message_id = $2 WHERE id = $3',
    [threadId, scoreMessageId, id]
  );
}

export async function isRoundComplete(tournamentId, round) {
  const row = await queryOne(
    "SELECT COUNT(*) as remaining FROM matches WHERE tournament_id = $1 AND round = $2 AND status NOT IN ('completed', 'cancelled')",
    [tournamentId, round]
  );
  return parseInt(row?.remaining ?? 0) === 0;
}

export async function isTournamentComplete(tournamentId) {
  const row = await queryOne(
    "SELECT COUNT(*) as remaining FROM matches WHERE tournament_id = $1 AND status NOT IN ('completed', 'cancelled')",
    [tournamentId]
  );
  return parseInt(row?.remaining ?? 0) === 0;
}

export async function getCompletedMatchCount(tournamentId) {
  const row = await queryOne(
    "SELECT COUNT(*) as count FROM matches WHERE tournament_id = $1 AND status = 'completed'",
    [tournamentId]
  );
  return parseInt(row?.count ?? 0);
}

export async function getTotalMatchCount(tournamentId) {
  const row = await queryOne(
    'SELECT COUNT(*) as count FROM matches WHERE tournament_id = $1',
    [tournamentId]
  );
  return parseInt(row?.count ?? 0);
}

export async function getMatchByThreadId(threadId) {
  return queryOne('SELECT * FROM matches WHERE thread_id = $1', [threadId]);
}

export async function cancelMatchesByPlayer(tournamentId, userId) {
  return execute(
    "UPDATE matches SET status = 'cancelled' WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2) AND status IN ('pending', 'in_progress')",
    [tournamentId, userId]
  );
}

export async function cancelAllPendingMatches(tournamentId) {
  return execute(
    "UPDATE matches SET status = 'cancelled', completed_at = NOW() WHERE tournament_id = $1 AND status IN ('pending', 'in_progress')",
    [tournamentId]
  );
}

export async function getCurrentRound(tournamentId) {
  const row = await queryOne('SELECT current_round FROM tournaments WHERE id = $1', [tournamentId]);
  return row?.current_round ?? 0;
}

export async function getMatchBetweenPlayers(tournamentId, userId1, userId2) {
  return queryOne(
    'SELECT * FROM matches WHERE tournament_id = $1 AND ((player1_id = $2 AND player2_id = $3) OR (player1_id = $3 AND player2_id = $2)) LIMIT 1',
    [tournamentId, userId1, userId2]
  );
}

// ═════════════════════════════════════════════════════════════════
//  AUTOROLE QUERIES
// ═════════════════════════════════════════════════════════════════

export async function addAutorole(guildId, roleId) {
  return execute(
    'INSERT INTO autoroles (guild_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [guildId, roleId]
  );
}

export async function removeAutorole(guildId, roleId) {
  return execute('DELETE FROM autoroles WHERE guild_id = $1 AND role_id = $2', [guildId, roleId]);
}

export async function getAutoroles(guildId) {
  return queryAll('SELECT * FROM autoroles WHERE guild_id = $1', [guildId]);
}

export async function clearAutoroles(guildId) {
  return execute('DELETE FROM autoroles WHERE guild_id = $1', [guildId]);
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY CONFIG QUERIES
// ═════════════════════════════════════════════════════════════════

export async function getGiveawayConfig(guildId) {
  return queryOne('SELECT * FROM giveaway_config WHERE guild_id = $1', [guildId]);
}

export async function setGiveawayConfig(guildId, staffRoleId, pingRoleId = null) {
  return execute(
    'INSERT INTO giveaway_config (guild_id, staff_role_id, ping_role_id) VALUES ($1, $2, $3) ON CONFLICT(guild_id) DO UPDATE SET staff_role_id = $2, ping_role_id = $3',
    [guildId, staffRoleId, pingRoleId]
  );
}

export async function updateGiveawayPingRole(guildId, pingRoleId) {
  return execute('UPDATE giveaway_config SET ping_role_id = $1 WHERE guild_id = $2', [pingRoleId, guildId]);
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY CHANNEL QUERIES
// ═════════════════════════════════════════════════════════════════

export async function addGiveawayChannel(guildId, channelId) {
  return execute(
    'INSERT INTO giveaway_channels (guild_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [guildId, channelId]
  );
}

export async function removeGiveawayChannel(guildId, channelId) {
  return execute('DELETE FROM giveaway_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, channelId]);
}

export async function getGiveawayChannels(guildId) {
  return queryAll('SELECT * FROM giveaway_channels WHERE guild_id = $1', [guildId]);
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY QUERIES
// ═════════════════════════════════════════════════════════════════

export async function createGiveaway({ guildId, creatorId, prize, description, winnerCount, durationMinutes }) {
  const { rows } = await getPool().query(
    'INSERT INTO giveaways (guild_id, creator_id, prize, description, winner_count, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [guildId, creatorId, prize, description, winnerCount, durationMinutes]
  );
  return { lastInsertRowid: rows[0].id };
}

export async function getGiveawayById(id) {
  return queryOne('SELECT * FROM giveaways WHERE id = $1', [id]);
}

export async function getActiveGiveaways(guildId) {
  return queryAll(
    "SELECT * FROM giveaways WHERE guild_id = $1 AND status = 'approved' ORDER BY ends_at ASC",
    [guildId]
  );
}

export async function getPendingGiveaways(guildId) {
  return queryAll(
    "SELECT * FROM giveaways WHERE guild_id = $1 AND status = 'pending' ORDER BY created_at ASC",
    [guildId]
  );
}

export async function getExpiredGiveaways() {
  return queryAll(
    "SELECT * FROM giveaways WHERE status = 'approved' AND ends_at IS NOT NULL AND ends_at <= NOW()"
  );
}

export async function updateGiveawayStatus(id, status) {
  return execute('UPDATE giveaways SET status = $1 WHERE id = $2', [status, id]);
}

export async function updateGiveawayApproval(id, { channelId, messageId, endsAt }) {
  return execute(
    "UPDATE giveaways SET status = 'approved', channel_id = $1, message_id = $2, ends_at = $3 WHERE id = $4",
    [channelId, messageId, endsAt, id]
  );
}

export async function updateGiveawayEnd(id) {
  return execute("UPDATE giveaways SET status = 'ended', ended_at = NOW() WHERE id = $1", [id]);
}

export async function updateGiveawayReviewMessage(id, reviewMessageId, reviewChannelId) {
  return execute(
    'UPDATE giveaways SET review_message_id = $1, review_channel_id = $2 WHERE id = $3',
    [reviewMessageId, reviewChannelId, id]
  );
}

export async function updateGiveawayMessage(id, messageId) {
  return execute('UPDATE giveaways SET message_id = $1 WHERE id = $2', [messageId, id]);
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY ENTRY QUERIES
// ═════════════════════════════════════════════════════════════════

export async function addGiveawayEntry(giveawayId, userId) {
  return execute(
    'INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [giveawayId, userId]
  );
}

export async function removeGiveawayEntry(giveawayId, userId) {
  return execute(
    'DELETE FROM giveaway_entries WHERE giveaway_id = $1 AND user_id = $2',
    [giveawayId, userId]
  );
}

export async function getGiveawayEntries(giveawayId) {
  return queryAll(
    'SELECT * FROM giveaway_entries WHERE giveaway_id = $1 ORDER BY entered_at ASC',
    [giveawayId]
  );
}

export async function getGiveawayEntryCount(giveawayId) {
  const row = await queryOne(
    'SELECT COUNT(*) as count FROM giveaway_entries WHERE giveaway_id = $1',
    [giveawayId]
  );
  return parseInt(row?.count ?? 0);
}

export async function hasEnteredGiveaway(giveawayId, userId) {
  const row = await queryOne(
    'SELECT 1 FROM giveaway_entries WHERE giveaway_id = $1 AND user_id = $2',
    [giveawayId, userId]
  );
  return !!row;
}

export async function deleteGiveawayEntries(giveawayId) {
  return execute('DELETE FROM giveaway_entries WHERE giveaway_id = $1', [giveawayId]);
}
