// ─── src/services/giveawayTimer.js ───────────────────────────────

import { getExpiredGiveaways, getGiveawayById } from '../database/queries.js';
import { endGiveaway } from './giveawayService.js';

let timerInterval = null;

export function startGiveawayTimer(client) {
  if (timerInterval) clearInterval(timerInterval);
  checkExpiredGiveaways(client);
  timerInterval = setInterval(() => checkExpiredGiveaways(client), 30_000);
  console.log('[GIVEAWAY] Timer started — checking every 30 seconds');
}

export function stopGiveawayTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    console.log('[GIVEAWAY] Timer stopped');
  }
}

async function checkExpiredGiveaways(client) {
  try {
    const expired = await getExpiredGiveaways();
    if (expired.length === 0) return;

    console.log(`[GIVEAWAY] Found ${expired.length} expired giveaway(s)`);

    for (const giveaway of expired) {
      try {
        const fresh = await getGiveawayById(giveaway.id);
        if (!fresh || fresh.status !== 'approved') continue;

        const guild = client.guilds.cache.get(giveaway.guild_id);
        if (!guild) continue;

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
