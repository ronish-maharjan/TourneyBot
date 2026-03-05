// ─── src/database/queries.js ─────────────────────────────────────
// Pure data-access functions.  Every function is synchronous because
// node:sqlite (DatabaseSync) is synchronous.  They are called from
// async Discord.js handlers — that is perfectly fine.

import { getDatabase } from "./init.js";

// ═════════════════════════════════════════════════════════════════
//  TOURNAMENT QUERIES
// ═════════════════════════════════════════════════════════════════

/**
 * Insert a new tournament row.
 * @param {object} t
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
export function createTournament({ id, guildId, name, createdBy }) {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO tournaments (id, guild_id, name, created_by)
     VALUES (?, ?, ?, ?)`,
  );
  return stmt.run(id, guildId, name, createdBy);
}

/**
 * Fetch a single tournament by its UUID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getTournamentById(id) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
}

/**
 * Find which tournament a Discord channel belongs to.
 * Checks every stored channel-ID column + the category.
 * @param {string} channelId
 * @returns {object|undefined}
 */
export function getTournamentByChannelId(channelId) {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM tournaments
    WHERE category_id              = ?
       OR leaderboard_channel_id   = ?
       OR admin_channel_id         = ?
       OR notice_channel_id        = ?
       OR registration_channel_id  = ?
       OR participation_channel_id = ?
       OR bracket_channel_id       = ?
       OR result_channel_id        = ?
       OR chat_channel_id          = ?
       OR match_channel_id         = ?
  `);
  return stmt.get(
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
    channelId,
  );
}

/**
 * All tournaments in a guild (any status).
 * @param {string} guildId
 * @returns {object[]}
 */
export function getTournamentsByGuild(guildId) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM tournaments WHERE guild_id = ? ORDER BY created_at DESC",
    )
    .all(guildId);
}

/**
 * Tournaments that are not completed / cancelled.
 * @param {string} guildId
 * @returns {object[]}
 */
export function getActiveTournamentsByGuild(guildId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM tournaments
    WHERE guild_id = ?
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY created_at DESC
  `,
    )
    .all(guildId);
}

/**
 * Update editable config fields (name, max_players, team_size, best_of, rules).
 */
export function updateTournamentConfig(
  id,
  { name, maxPlayers, teamSize, bestOf, rules },
) {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE tournaments
    SET name        = ?,
        max_players = ?,
        team_size   = ?,
        best_of     = ?,
        rules       = ?
    WHERE id = ?
  `);
  return stmt.run(name, maxPlayers, teamSize, bestOf, rules ?? "", id);
}
/**
 * Change tournament status.
 * @param {string} id
 * @param {string} status  One of TOURNAMENT_STATUS values.
 */
export function updateTournamentStatus(id, status) {
  const db = getDatabase();
  return db
    .prepare("UPDATE tournaments SET status = ? WHERE id = ?")
    .run(status, id);
}

/**
 * Persist all channel Discord IDs after creation.
 * @param {string} id  Tournament ID.
 * @param {object} ch  Map of channel names → Discord IDs.
 */
export function updateTournamentChannels(
  id,
  {
    categoryId,
    leaderboardChannelId,
    adminChannelId,
    noticeChannelId,
    registrationChannelId,
    participationChannelId,
    bracketChannelId,
    resultChannelId,
    chatChannelId,
    matchChannelId,
  },
) {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE tournaments SET
      category_id              = ?,
      leaderboard_channel_id   = ?,
      admin_channel_id         = ?,
      notice_channel_id        = ?,
      registration_channel_id  = ?,
      participation_channel_id = ?,
      bracket_channel_id       = ?,
      result_channel_id        = ?,
      chat_channel_id          = ?,
      match_channel_id         = ?
    WHERE id = ?
  `);
  return stmt.run(
    categoryId,
    leaderboardChannelId,
    adminChannelId,
    noticeChannelId,
    registrationChannelId,
    participationChannelId,
    bracketChannelId,
    resultChannelId,
    chatChannelId,
    matchChannelId,
    id,
  );
}

/**
 * Persist role Discord IDs.
 */
export function updateTournamentRoles(
  id,
  { organizerRoleId, participantRoleId, spectatorRoleId },
) {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE tournaments SET
      organizer_role_id   = ?,
      participant_role_id = ?,
      spectator_role_id   = ?
    WHERE id = ?
  `);
  return stmt.run(organizerRoleId, participantRoleId, spectatorRoleId, id);
}

/**
 * Update a single message-ID column.
 * @param {string} id       Tournament ID.
 * @param {string} field    Column name (must be one of the *_message_id columns).
 * @param {string} messageId Discord message snowflake.
 */
const VALID_MESSAGE_FIELDS = new Set([
  "leaderboard_message_id",
  "bracket_message_id",
  "participation_message_id",
  "admin_message_id",
  "registration_message_id",
]);
export function updateTournamentMessageId(id, field, messageId) {
  if (!VALID_MESSAGE_FIELDS.has(field)) {
    throw new Error(`Invalid message field: ${field}`);
  }
  const db = getDatabase();
  // Field is validated above — safe to interpolate.
  return db
    .prepare(`UPDATE tournaments SET ${field} = ? WHERE id = ?`)
    .run(messageId, id);
}

/**
 * Update round tracking.
 */
export function updateTournamentRound(id, currentRound, totalRounds) {
  const db = getDatabase();
  return db
    .prepare(
      "UPDATE tournaments SET current_round = ?, total_rounds = ? WHERE id = ?",
    )
    .run(currentRound, totalRounds, id);
}

/**
 * Hard-delete a tournament row.  Cascades to participants & matches.
 */
export function deleteTournament(id) {
  const db = getDatabase();
  return db.prepare("DELETE FROM tournaments WHERE id = ?").run(id);
}

// ═════════════════════════════════════════════════════════════════
//  PARTICIPANT QUERIES
// ═════════════════════════════════════════════════════════════════

/**
 * Register a user for a tournament.
 */
export function addParticipant({
  tournamentId,
  userId,
  username,
  displayName,
  role = "participant",
}) {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO participants (tournament_id, user_id, username, display_name, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(tournamentId, userId, username, displayName, role);
}

/**
 * Unregister a user (hard delete).
 */
export function removeParticipant(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare("DELETE FROM participants WHERE tournament_id = ? AND user_id = ?")
    .run(tournamentId, userId);
}

/**
 * Get one participant row.
 */
export function getParticipant(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM participants WHERE tournament_id = ? AND user_id = ?",
    )
    .get(tournamentId, userId);
}

/**
 * All participants (any role / status).
 */
export function getParticipantsByTournament(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM participants
     WHERE tournament_id = ?
     ORDER BY points DESC, wins DESC, username ASC`,
    )
    .all(tournamentId);
}

/**
 * Only active participants (role = 'participant', status = 'active').
 */
export function getActiveParticipants(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM participants
    WHERE tournament_id = ?
      AND role   = 'participant'
      AND status = 'active'
    ORDER BY points DESC, wins DESC, username ASC
  `,
    )
    .all(tournamentId);
}

/**
 * Count of active participants.
 */
export function getActiveParticipantCount(tournamentId) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM participants
    WHERE tournament_id = ?
      AND role   = 'participant'
      AND status = 'active'
  `,
    )
    .get(tournamentId);
  return row?.count ?? 0;
}

/**
 * Count of all registered participants (including spectators).
 */
export function getParticipantCount(tournamentId) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM participants
    WHERE tournament_id = ? AND role = 'participant'
  `,
    )
    .get(tournamentId);
  return row?.count ?? 0;
}

/**
 * Get spectators only.
 */
export function getSpectators(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM participants
    WHERE tournament_id = ? AND role = 'spectator'
    ORDER BY username ASC
  `,
    )
    .all(tournamentId);
}

/**
 * Switch a user between participant / spectator.
 */
export function updateParticipantRole(tournamentId, userId, role) {
  const db = getDatabase();
  return db
    .prepare(
      "UPDATE participants SET role = ? WHERE tournament_id = ? AND user_id = ?",
    )
    .run(role, tournamentId, userId);
}

/**
 * Mark a participant as disqualified (or re-activate).
 */
export function updateParticipantStatus(tournamentId, userId, status) {
  const db = getDatabase();
  return db
    .prepare(
      "UPDATE participants SET status = ? WHERE tournament_id = ? AND user_id = ?",
    )
    .run(status, tournamentId, userId);
}

/**
 * Increment / set stats after a match result.
 * @param {string} tournamentId
 * @param {string} userId
 * @param {object} stats  { points, wins, losses, draws, matchesPlayed }
 */
export function updateParticipantStats(
  tournamentId,
  userId,
  { points, wins, losses, draws, matchesPlayed },
) {
  const db = getDatabase();
  return db
    .prepare(
      `
    UPDATE participants SET
      points         = ?,
      wins           = ?,
      losses         = ?,
      draws          = ?,
      matches_played = ?
    WHERE tournament_id = ? AND user_id = ?
  `,
    )
    .run(points, wins, losses, draws, matchesPlayed, tournamentId, userId);
}

/**
 * Increment stats by delta (handy after a single match).
 */
export function incrementParticipantStats(
  tournamentId,
  userId,
  { pointsDelta = 0, winsDelta = 0, lossesDelta = 0, drawsDelta = 0 },
) {
  const db = getDatabase();
  return db
    .prepare(
      `
    UPDATE participants SET
      points         = points         + ?,
      wins           = wins           + ?,
      losses         = losses         + ?,
      draws          = draws          + ?,
      matches_played = matches_played + 1
    WHERE tournament_id = ? AND user_id = ?
  `,
    )
    .run(pointsDelta, winsDelta, lossesDelta, drawsDelta, tournamentId, userId);
}

/**
 * Delete all participants for a tournament (used on tournament delete).
 */
export function deleteParticipantsByTournament(tournamentId) {
  const db = getDatabase();
  return db
    .prepare("DELETE FROM participants WHERE tournament_id = ?")
    .run(tournamentId);
}

// ═════════════════════════════════════════════════════════════════
//  MATCH QUERIES
// ═════════════════════════════════════════════════════════════════

/**
 * Insert a single match row.
 */
export function createMatch({
  tournamentId,
  round,
  matchNumber,
  player1Id,
  player2Id,
}) {
  const db = getDatabase();
  return db
    .prepare(
      `
    INSERT INTO matches (tournament_id, round, match_number, player1_id, player2_id)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(tournamentId, round, matchNumber, player1Id, player2Id);
}

/**
 * Bulk-insert matches for a round (uses a transaction for atomicity).
 * @param {object[]} matches  Array of { tournamentId, round, matchNumber, player1Id, player2Id }
 */
export function createMatchesBulk(matches) {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO matches (tournament_id, round, match_number, player1_id, player2_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (const m of matches) {
      stmt.run(
        m.tournamentId,
        m.round,
        m.matchNumber,
        m.player1Id,
        m.player2Id,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Get a match by its auto-increment ID.
 */
export function getMatchById(id) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM matches WHERE id = ?").get(id);
}

/**
 * All matches for a tournament.
 */
export function getMatchesByTournament(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, match_number",
    )
    .all(tournamentId);
}

/**
 * Matches in a specific round.
 */
export function getMatchesByRound(tournamentId, round) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM matches WHERE tournament_id = ? AND round = ? ORDER BY match_number",
    )
    .all(tournamentId, round);
}

/**
 * All matches involving a player (any status).
 */
export function getMatchesByPlayer(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM matches
    WHERE tournament_id = ?
      AND (player1_id = ? OR player2_id = ?)
    ORDER BY round, match_number
  `,
    )
    .all(tournamentId, userId, userId);
}

/**
 * The player's currently active match (status = 'in_progress').
 */
export function getActiveMatchByPlayer(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM matches
    WHERE tournament_id = ?
      AND (player1_id = ? OR player2_id = ?)
      AND status = 'in_progress'
    LIMIT 1
  `,
    )
    .get(tournamentId, userId, userId);
}

/**
 * All pending matches for a player.
 */
export function getPendingMatchesByPlayer(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM matches
    WHERE tournament_id = ?
      AND (player1_id = ? OR player2_id = ?)
      AND status = 'pending'
    ORDER BY round, match_number
  `,
    )
    .all(tournamentId, userId, userId);
}

/**
 * Get the next pending match where BOTH players are free
 * (neither has an in_progress match).
 */
export function getNextAvailableMatch(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT m.* FROM matches m
    WHERE m.tournament_id = ?
      AND m.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM matches m2
        WHERE m2.tournament_id = m.tournament_id
          AND m2.status = 'in_progress'
          AND (m2.player1_id = m.player1_id OR m2.player2_id = m.player1_id
            OR m2.player1_id = m.player2_id OR m2.player2_id = m.player2_id)
      )
    ORDER BY m.round, m.match_number
    LIMIT 1
  `,
    )
    .get(tournamentId);
}

/**
 * Get ALL pending matches where both players are currently free.
 */
export function getAllAvailableMatches(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT m.* FROM matches m
    WHERE m.tournament_id = ?
      AND m.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM matches m2
        WHERE m2.tournament_id = m.tournament_id
          AND m2.status = 'in_progress'
          AND (m2.player1_id = m.player1_id OR m2.player2_id = m.player1_id
            OR m2.player1_id = m.player2_id OR m2.player2_id = m.player2_id)
      )
    ORDER BY m.round, m.match_number
  `,
    )
    .all(tournamentId);
}

/**
 * Update the running score for a match (used during best-of-N).
 */
export function updateMatchScore(id, player1Score, player2Score) {
  const db = getDatabase();
  return db
    .prepare(
      "UPDATE matches SET player1_score = ?, player2_score = ? WHERE id = ?",
    )
    .run(player1Score, player2Score, id);
}

/**
 * Record the final result of a match.
 */
export function updateMatchResult(
  id,
  { winnerId, loserId, player1Score, player2Score },
) {
  const db = getDatabase();
  return db
    .prepare(
      `
    UPDATE matches SET
      winner_id     = ?,
      loser_id      = ?,
      player1_score = ?,
      player2_score = ?,
      status        = 'completed',
      completed_at  = datetime('now')
    WHERE id = ?
  `,
    )
    .run(winnerId, loserId, player1Score, player2Score, id);
}

/**
 * Change match status.
 */
export function updateMatchStatus(id, status) {
  const db = getDatabase();
  return db
    .prepare("UPDATE matches SET status = ? WHERE id = ?")
    .run(status, id);
}

/**
 * Store Discord thread / message IDs on a match.
 */
export function updateMatchThread(id, threadId, scoreMessageId) {
  const db = getDatabase();
  return db
    .prepare(
      "UPDATE matches SET thread_id = ?, score_message_id = ? WHERE id = ?",
    )
    .run(threadId, scoreMessageId, id);
}

/**
 * Check if every match in a round is completed.
 */
export function isRoundComplete(tournamentId, round) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as remaining FROM matches
    WHERE tournament_id = ?
      AND round = ?
      AND status NOT IN ('completed', 'cancelled')
  `,
    )
    .get(tournamentId, round);
  return (row?.remaining ?? 0) === 0;
}

/**
 * Check if ALL matches in the tournament are done.
 */
export function isTournamentComplete(tournamentId) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as remaining FROM matches
    WHERE tournament_id = ?
      AND status NOT IN ('completed', 'cancelled')
  `,
    )
    .get(tournamentId);
  return (row?.remaining ?? 0) === 0;
}

/**
 * Count completed matches.
 */
export function getCompletedMatchCount(tournamentId) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM matches
    WHERE tournament_id = ? AND status = 'completed'
  `,
    )
    .get(tournamentId);
  return row?.count ?? 0;
}

/**
 * Total match count.
 */
export function getTotalMatchCount(tournamentId) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?
  `,
    )
    .get(tournamentId);
  return row?.count ?? 0;
}

/**
 * Get a match by its thread ID (handy for button interactions inside threads).
 */
export function getMatchByThreadId(threadId) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM matches WHERE thread_id = ?").get(threadId);
}

/**
 * Cancel all pending/in-progress matches involving a player
 * (used on disqualification).
 */
export function cancelMatchesByPlayer(tournamentId, userId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    UPDATE matches SET status = 'cancelled'
    WHERE tournament_id = ?
      AND (player1_id = ? OR player2_id = ?)
      AND status IN ('pending', 'in_progress')
  `,
    )
    .run(tournamentId, userId, userId);
}

/**
 * Delete all matches for a tournament (used on tournament delete).
 */
export function deleteMatchesByTournament(tournamentId) {
  const db = getDatabase();
  return db
    .prepare("DELETE FROM matches WHERE tournament_id = ?")
    .run(tournamentId);
}

/**
 * Get leaderboard (participants sorted by points, then wins, then losses asc).
 */
export function getLeaderboard(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM participants
    WHERE tournament_id = ?
      AND role = 'participant'
    ORDER BY points DESC, wins DESC, losses ASC, username ASC
  `,
    )
    .all(tournamentId);
}

/**
 * Find a match between two specific players in a tournament.
 */
export function getMatchBetweenPlayers(tournamentId, userId1, userId2) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM matches
    WHERE tournament_id = ?
      AND (
        (player1_id = ? AND player2_id = ?)
        OR (player1_id = ? AND player2_id = ?)
      )
    LIMIT 1
  `,
    )
    .get(tournamentId, userId1, userId2, userId2, userId1);
}

/**
 * Cancel ALL pending/in-progress matches for a tournament.
 * Used when ending a tournament early.
 */
export function cancelAllPendingMatches(tournamentId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    UPDATE matches SET
      status       = 'cancelled',
      completed_at = datetime('now')
    WHERE tournament_id = ?
      AND status IN ('pending', 'in_progress')
  `,
    )
    .run(tournamentId);
}
