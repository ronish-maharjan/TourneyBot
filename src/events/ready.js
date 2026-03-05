// ─── src/events/ready.js ────────────────────────────────────────
// Fires once when the client is ready.

import { ActivityType } from "discord.js";

/**
 * @param {import('discord.js').Client} client
 */
export function handleReady(client) {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Serving ${client.guilds.cache.size} guild(s)`);

  // Set a watching status
  client.user.setActivity("tournaments | /create", {
    type: ActivityType.Watching,
  });
}
