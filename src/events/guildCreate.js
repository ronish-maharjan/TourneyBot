// ─── src/events/guildCreate.js ───────────────────────────────────
// Creates TournamentOrganizer role when bot joins a new server.

import { ROLE_NAMES } from '../config.js';

/**
 * @param {import('discord.js').Guild} guild
 */
export async function handleGuildCreate(guild) {
  console.log(`[BOT] Joined new guild: ${guild.name} (${guild.id})`);

  try {
    const existing = guild.roles.cache.find(r => r.name === ROLE_NAMES.ORGANIZER);
    if (!existing) {
      await guild.roles.create({
        name: ROLE_NAMES.ORGANIZER,
        color: 0x5865F2,
        mentionable: false,
        reason: 'Tournament Bot — Organizer role (auto-created on join)',
      });
      console.log(`[ROLE] Created ${ROLE_NAMES.ORGANIZER} in ${guild.name}`);
    }
  } catch (err) {
    console.warn(`[ROLE] Could not create organizer role in ${guild.name}:`, err.message);
  }
}
