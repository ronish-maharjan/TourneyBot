// ─── src/events/ready.js ────────────────────────────────────────

import { ActivityType } from 'discord.js';
import { ROLE_NAMES, COLORS } from '../config.js';

/**
 * @param {import('discord.js').Client} client
 */
export async function handleReady(client) {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Serving ${client.guilds.cache.size} guild(s)`);

  client.user.setActivity('tournaments | /help', {
    type: ActivityType.Watching,
  });

  // Ensure TournamentOrganizer role exists in every guild
  for (const [, guild] of client.guilds.cache) {
    try {
      await ensureOrganizerRole(guild);
    } catch (err) {
      console.warn(`[ROLE] Could not ensure organizer role in ${guild.name}:`, err.message);
    }
  }
}

/**
 * Create TournamentOrganizer role if it doesn't exist.
 * @param {import('discord.js').Guild} guild
 */
async function ensureOrganizerRole(guild) {
  const existing = guild.roles.cache.find(r => r.name === ROLE_NAMES.ORGANIZER);
  if (existing) {
    console.log(`[ROLE] ${ROLE_NAMES.ORGANIZER} exists in ${guild.name}`);
    return existing;
  }

  const role = await guild.roles.create({
    name: ROLE_NAMES.ORGANIZER,
    color: 0x5865F2,
    mentionable: false,
    reason: 'Tournament Bot — Organizer role (auto-created on startup)',
  });

  console.log(`[ROLE] Created ${ROLE_NAMES.ORGANIZER} in ${guild.name}`);
  return role;
}
