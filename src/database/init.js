// ─── src/database/init.js ────────────────────────────────────────
// Bootstraps the SQLite database using better-sqlite3.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATABASE_PATH } from '../config.js';

/** @type {import('better-sqlite3').Database | null} */
let db = null;

/**
 * Initialise (or re-open) the database and ensure all tables exist.
 * @returns {import('better-sqlite3').Database}
 */
export function initializeDatabase() {
  const dir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DATABASE_PATH);

  // ── Pragmas ──────────────────────────────────────────────────
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ───────────────────────────────────────────────────
  db.exec(`
    -----------------------------------------------------------------
    -- TOURNAMENTS
    -----------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS tournaments (
      id                        TEXT PRIMARY KEY,
      guild_id                  TEXT    NOT NULL,
      name                      TEXT    NOT NULL,
      max_players               INTEGER NOT NULL DEFAULT 16,
      format                    TEXT    NOT NULL DEFAULT 'round_robin',
      team_size                 INTEGER NOT NULL DEFAULT 1,
      best_of                   INTEGER NOT NULL DEFAULT 1,
      rules                     TEXT    DEFAULT '',
      status                    TEXT    NOT NULL DEFAULT 'created',

      category_id               TEXT,
      leaderboard_channel_id    TEXT,
      admin_channel_id          TEXT,
      notice_channel_id         TEXT,
      registration_channel_id   TEXT,
      participation_channel_id  TEXT,
      bracket_channel_id        TEXT,
      result_channel_id         TEXT,
      chat_channel_id           TEXT,
      match_channel_id          TEXT,
      rules_channel_id          TEXT,

      organizer_role_id         TEXT,
      participant_role_id       TEXT,
      spectator_role_id         TEXT,

      leaderboard_message_id    TEXT,
      bracket_message_id        TEXT,
      participation_message_id  TEXT,
      admin_message_id          TEXT,
      registration_message_id   TEXT,
      rules_message_id          TEXT,

      current_round             INTEGER NOT NULL DEFAULT 0,
      total_rounds              INTEGER NOT NULL DEFAULT 0,

      created_by                TEXT    NOT NULL,
      created_at                TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -----------------------------------------------------------------
    -- PARTICIPANTS
    -----------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS participants (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id   TEXT    NOT NULL,
      user_id         TEXT    NOT NULL,
      username        TEXT    NOT NULL,
      display_name    TEXT,
      role            TEXT    NOT NULL DEFAULT 'participant',
      status          TEXT    NOT NULL DEFAULT 'active',
      points          INTEGER NOT NULL DEFAULT 0,
      wins            INTEGER NOT NULL DEFAULT 0,
      losses          INTEGER NOT NULL DEFAULT 0,
      draws           INTEGER NOT NULL DEFAULT 0,
      matches_played  INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      UNIQUE(tournament_id, user_id)
    );

    -----------------------------------------------------------------
    -- MATCHES
    -----------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS matches (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id     TEXT    NOT NULL,
      round             INTEGER NOT NULL,
      match_number      INTEGER NOT NULL,
      player1_id        TEXT,
      player2_id        TEXT,
      winner_id         TEXT,
      loser_id          TEXT,
      player1_score     INTEGER NOT NULL DEFAULT 0,
      player2_score     INTEGER NOT NULL DEFAULT 0,
      status            TEXT    NOT NULL DEFAULT 'pending',
      thread_id         TEXT,
      score_message_id  TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at      TEXT,

      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
    );

    -----------------------------------------------------------------
    -- INDEXES
    -----------------------------------------------------------------
    CREATE INDEX IF NOT EXISTS idx_tournaments_guild
      ON tournaments(guild_id);

    CREATE INDEX IF NOT EXISTS idx_participants_tournament
      ON participants(tournament_id);

    CREATE INDEX IF NOT EXISTS idx_participants_user
      ON participants(tournament_id, user_id);

    CREATE INDEX IF NOT EXISTS idx_matches_tournament
      ON matches(tournament_id);

    CREATE INDEX IF NOT EXISTS idx_matches_round
      ON matches(tournament_id, round);

    CREATE INDEX IF NOT EXISTS idx_matches_players
      ON matches(tournament_id, player1_id, player2_id);

    CREATE INDEX IF NOT EXISTS idx_matches_status
      ON matches(tournament_id, status);

    -----------------------------------------------------------------
    -- AUTOROLES
    -----------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS autoroles (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id  TEXT NOT NULL,
      role_id   TEXT NOT NULL,
      UNIQUE(guild_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_autoroles_guild
      ON autoroles(guild_id);
  `);

  console.log('[DB] Database initialised successfully.');
  return db;
}

/**
 * Return the active database handle.
 * @returns {import('better-sqlite3').Database}
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialised. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Gracefully close the database.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database closed.');
  }
}

