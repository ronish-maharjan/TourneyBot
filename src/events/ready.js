// ─── src/events/ready.js ────────────────────────────────────────
import { ActivityType } from 'discord.js';

/**
 * @param {import('discord.js').Client} client
 */
export function handleReady(client) {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Serving ${client.guilds.cache.size} guild(s)`);

  client.user.setActivity('tournaments | /help', {
    type: ActivityType.Watching,
  });
}
