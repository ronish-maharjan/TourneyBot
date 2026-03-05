// ─── src/config.js ───────────────────────────────────────────────
// Central configuration: constants, enums, and defaults used across the bot.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Paths ────────────────────────────────────────────────────────
export const DATABASE_PATH = path.join(
  __dirname,
  "..",
  "data",
  "tournament.db",
);

// ── Tournament Status Enum ───────────────────────────────────────
export const TOURNAMENT_STATUS = Object.freeze({
  CREATED: "created",
  REGISTRATION_OPEN: "registration_open",
  REGISTRATION_CLOSED: "registration_closed",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// ── Participant Status Enum ──────────────────────────────────────
export const PARTICIPANT_STATUS = Object.freeze({
  ACTIVE: "active",
  DISQUALIFIED: "disqualified",
});

// ── Participant Role Enum ────────────────────────────────────────
export const PARTICIPANT_ROLE = Object.freeze({
  PARTICIPANT: "participant",
  SPECTATOR: "spectator",
});

// ── Match Status Enum ────────────────────────────────────────────
export const MATCH_STATUS = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// ── Scoring ──────────────────────────────────────────────────────
export const POINTS = Object.freeze({
  WIN: 3,
  LOSS: 0,
  DRAW: 1,
});

// ── Tournament Defaults & Limits ─────────────────────────────────
export const MAX_PLAYERS_LIMIT = 100;
export const DEFAULT_MAX_PLAYERS = 16;
export const DEFAULT_BEST_OF = 1;
export const VALID_BEST_OF = [1, 3]; // only odd values → no draws
export const VALID_TEAM_SIZES = [1, 2]; // solo or duo

// ── Channel Names (created under the tournament category) ────────
export const CHANNEL_NAMES = Object.freeze({
  LEADERBOARD: "leaderboard",
  ADMIN: "admin",
  NOTICE: "notice",
  REGISTRATION: "registration",
  PARTICIPATION: "participation",
  BRACKET: "bracket",
  RESULT: "result",
  CHAT: "chat",
  MATCH: "matches",
});

// ── Role Names ───────────────────────────────────────────────────
// TournamentOrganizer is server-wide and persistent.
// Participant / Spectator roles are per-tournament (prefixed with tournament name).
export const ROLE_NAMES = Object.freeze({
  ORGANIZER: "TournamentOrganizer",
  PARTICIPANT: "Participant", // will be prefixed → "{TournamentName} Participant"
  SPECTATOR: "Spectator", // will be prefixed → "{TournamentName} Spectator"
});

// ── Embed Colours ────────────────────────────────────────────────
export const COLORS = Object.freeze({
  PRIMARY: 0x5865f2, // blurple
  SUCCESS: 0x57f287, // green
  WARNING: 0xfee75c, // yellow
  DANGER: 0xed4245, // red
  INFO: 0x5865f2,
  NEUTRAL: 0x2f3136,
});
