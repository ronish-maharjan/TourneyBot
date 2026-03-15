// ─── src/utils/helpers.js ────────────────────────────────────────
// General-purpose utility functions used across the bot.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTournamentByChannelId } from "../database/queries.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═════════════════════════════════════════════════════════════════
//  ID GENERATION
// ═════════════════════════════════════════════════════════════════

/**
 * Generate a 16-character hex ID for tournaments.
 * @returns {string}
 */
export function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

// ═════════════════════════════════════════════════════════════════
//  COMMAND LOADER
// ═════════════════════════════════════════════════════════════════

/**
 * Recursively load all command files from src/commands/<category>/*.js
 * and register them on client.commands.
 *
 * @param {import('discord.js').Client} client
 */
export async function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands");
  const categories = fs.readdirSync(commandsPath);
  let count = 0;

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith(".js"));

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const fileUrl = pathToFileURL(filePath).href;

      try {
        const mod = await import(fileUrl);

        if (mod.data && mod.execute) {
          client.commands.set(mod.data.name, mod);
          count++;
          console.log(`[CMD] Loaded: /${mod.data.name}`);
        } else {
          console.warn(
            `[CMD] Skipped ${file}: missing 'data' or 'execute' export`,
          );
        }
      } catch (err) {
        console.error(`[CMD] Failed to load ${file}:`, err);
      }
    }
  }

  console.log(`[CMD] Total commands loaded: ${count}`);
}

// ═════════════════════════════════════════════════════════════════
//  TOURNAMENT CONTEXT
// ═════════════════════════════════════════════════════════════════

/**
 * Resolve the tournament a channel (or thread) belongs to.
 * Checks the channel itself, then parent (for threads inside tournament channels).
 *
 * @param {string}      channelId
 * @param {string|null} parentId   Parent channel ID (for threads)
 * @returns {object|undefined}
 */
export function findTournamentByContext(channelId, parentId = null) {
  let tournament = getTournamentByChannelId(channelId);
  if (!tournament && parentId) {
    tournament = getTournamentByChannelId(parentId);
  }
  return tournament;
}

// ═════════════════════════════════════════════════════════════════
//  FORMATTING HELPERS
// ═════════════════════════════════════════════════════════════════

/**
 * Human-readable status label with emoji.
 * @param {string} status
 * @returns {string}
 */
export function formatStatus(status) {
  const map = {
    created: "📋 Created",
    registration_open: "📝 Registration Open",
    registration_closed: "🔒 Registration Closed",
    in_progress: "⚔️ In Progress",
    completed: "✅ Completed",
    cancelled: "❌ Cancelled",
  };
  return map[status] ?? status;
}

/**
 * Truncate a string and append "…" if it exceeds maxLen.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 100) {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

/**
 * Discord-relative timestamp (e.g. <t:1700000000:R>).
 * @param {Date|string|number} date
 * @param {'t'|'T'|'d'|'D'|'f'|'F'|'R'} style
 * @returns {string}
 */
export function discordTimestamp(date, style = "f") {
  const epoch = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${epoch}:${style}>`;
}

/**
 * Ordinal suffix for a number (1st, 2nd, 3rd …).
 * @param {number} n
 * @returns {string}
 */
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Promise-based sleep.
 * @param {number} ms  Milliseconds to wait.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═════════════════════════════════════════════════════════════════
//  SAFE MESSAGE OPERATIONS
// ═════════════════════════════════════════════════════════════════

/**
 * Safely fetch a message from a channel.
 * Returns null if channel or message doesn't exist.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {string} messageId
 * @returns {Promise<{ channel: import('discord.js').TextChannel, message: import('discord.js').Message } | null>}
 */
export async function safeFetchMessage(guild, channelId, messageId) {
  if (!channelId || !messageId) return null;

  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return null;

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return { channel, message: null };

    return { channel, message };
  } catch {
    return null;
  }
}
