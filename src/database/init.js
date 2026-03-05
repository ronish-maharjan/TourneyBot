// ─── src/database/init.js ────────────────────────────────────────
// Bootstraps the SQLite database: creates the file/directory if needed,
// enables WAL + foreign keys, and runs the schema migration.
// Updated in Stage 2: added `rules` column to tournaments.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_PATH } from "../config.js";

/** @type {DatabaseSync | null} */
let db = null;

/**
 * Initialise (or re-open) the database and ensure all tables exist.
 * @returns {DatabaseSync}
 */
export function initializeDatabase() {
  const dir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(DATABASE_PATH);

  // ── Pragmas ──────────────────────────────────────────────────
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

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

      /* Discord IDs – filled after channel/role creation */
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

      organizer_role_id         TEXT,
      participant_role_id       TEXT,
      spectator_role_id         TEXT,

      /* Message IDs for editable embeds */
      leaderboard_message_id    TEXT,
      bracket_message_id        TEXT,
      participation_message_id  TEXT,
      admin_message_id          TEXT,
      registration_message_id   TEXT,

      /* Round tracking */
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
  `);

  console.log("[DB] Database initialised successfully.");
  return db;
}

/**
 * Return the active database handle.
 * @returns {DatabaseSync}
 */
export function getDatabase() {
  if (!db) {
    throw new Error(
      "Database not initialised. Call initializeDatabase() first.",
    );
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
    console.log("[DB] Database closed.");
  }
}
