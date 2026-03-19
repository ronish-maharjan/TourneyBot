// ─── src/database/init.js ────────────────────────────────────────
// PostgreSQL database connection and schema management.

import pg from 'pg';

const { Pool } = pg;

/** @type {pg.Pool | null} */
let pool = null;

/**
 * Initialise the PostgreSQL connection pool and run schema migrations.
 * @returns {Promise<pg.Pool>}
 */
export async function initializeDatabase() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error('DATABASE_URL is not set in .env');
    }

    /** for local db
    pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
     **/
    const isAiven = connectionString.includes("aivencloud");

    pool = new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: isAiven
        ? { rejectUnauthorized: false }
        : false
    });
    // Test connection
    const client = await pool.connect();
    try {
        await client.query('SELECT NOW()');
        console.log('[DB] Connected to PostgreSQL');
    } finally {
        client.release();
    }

    // Run schema
    await runSchema();

    console.log('[DB] Database initialised successfully.');
    return pool;
}

/**
 * Run schema migrations.
 */
async function runSchema() {
    await pool.query(`
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
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id              SERIAL PRIMARY KEY,
      tournament_id   TEXT    NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
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
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tournament_id, user_id)
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id                SERIAL PRIMARY KEY,
      tournament_id     TEXT    NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
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
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at      TIMESTAMPTZ
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS autoroles (
      id        SERIAL PRIMARY KEY,
      guild_id  TEXT NOT NULL,
      role_id   TEXT NOT NULL,
      UNIQUE(guild_id, role_id)
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_config (
      guild_id        TEXT PRIMARY KEY,
      staff_role_id   TEXT NOT NULL,
      ping_role_id    TEXT
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_channels (
      id         SERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      UNIQUE(guild_id, channel_id)
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id                  SERIAL PRIMARY KEY,
      guild_id            TEXT    NOT NULL,
      creator_id          TEXT    NOT NULL,
      prize               TEXT    NOT NULL,
      description         TEXT    DEFAULT '',
      winner_count        INTEGER NOT NULL DEFAULT 1,
      duration_minutes    INTEGER NOT NULL DEFAULT 60,
      status              TEXT    NOT NULL DEFAULT 'pending',
      channel_id          TEXT,
      message_id          TEXT,
      review_message_id   TEXT,
      review_channel_id   TEXT,
      ends_at             TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at            TIMESTAMPTZ
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id            SERIAL PRIMARY KEY,
      giveaway_id   INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
      user_id       TEXT    NOT NULL,
      entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(giveaway_id, user_id)
    )
  `);

    // Indexes
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_tournaments_guild ON tournaments(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_participants_tournament ON participants(tournament_id)',
        'CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(tournament_id, user_id)',
        'CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id)',
        'CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(tournament_id, round)',
        'CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(tournament_id, player1_id, player2_id)',
        'CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(tournament_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_autoroles_guild ON autoroles(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_giveaway_channels_guild ON giveaway_channels(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(guild_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway ON giveaway_entries(giveaway_id)',
    ];

    for (const idx of indexes) {
        await pool.query(idx);
    }
}

/**
 * Return the active pool.
 * @returns {pg.Pool}
 */
export function getPool() {
    if (!pool) {
        throw new Error('Database not initialised. Call initializeDatabase() first.');
    }
    return pool;
}

/**
 * Gracefully close the pool.
 */
export async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('[DB] Database closed.');
    }
}
