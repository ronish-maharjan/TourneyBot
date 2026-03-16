// ─── src/services/giveawayTimer.js ───────────────────────────────
// Checks every 60 seconds for expired giveaways and ends them.

import { getExpiredGiveaways, getGiveawayById } from '../database/queries.js';
import { endGiveaway } from './giveawayService.js';

let timerInterval = null;

/**
 * Start the giveaway timer that checks for expired giveaways.
 * @param {import('discord.js').Client} client
 */
export function startGiveawayTimer(client) {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Check immediately on start
  checkExpiredGiveaways(client);

  // Then check every 30 seconds
  timerInterval = setInterval(() => {
    checkExpiredGiveaways(client);
  }, 30_000);

  console.log('[GIVEAWAY] Timer started — checking every 30 seconds');
}

/**
 * Stop the giveaway timer.
 */
export function stopGiveawayTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    console.log('[GIVEAWAY] Timer stopped');
  }
}

/**
 * Find and end all expired giveaways.
 * @param {import('discord.js').Client} client
 */
async function checkExpiredGiveaways(client) {
  try {
    const expired = getExpiredGiveaways();

    if (expired.length === 0) return;

    console.log(`[GIVEAWAY] Found ${expired.length} expired giveaway(s)`);

    for (const giveaway of expired) {
      try {
        // Double-check it's still approved (not ended by staff already)
        const fresh = getGiveawayById(giveaway.id);
        if (!fresh || fresh.status !== 'approved') continue;

        const guild = client.guilds.cache.get(giveaway.guild_id);
        if (!guild) {
          console.warn(`[GIVEAWAY] Guild not found for giveaway #${giveaway.id}`);
          continue;
        }

        console.log(`[GIVEAWAY] Auto-ending #${giveaway.id} "${giveaway.prize}"`);
        await endGiveaway(guild, fresh);

      } catch (err) {
        console.error(`[GIVEAWAY] Failed to auto-end #${giveaway.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[GIVEAWAY] Timer check failed:', err.message);
  }
}
