// ─── src/index.js ────────────────────────────────────────────────
// Entry point: initialises DB, loads commands, wires events, logs in.

import "dotenv/config";
import { Client, Collection, GatewayIntentBits, Events } from "discord.js";
import { initializeDatabase, closeDatabase } from "./database/init.js";
import { loadCommands } from "./utils/helpers.js";
import { handleReady } from "./events/ready.js";
import { handleInteraction } from "./events/interactionCreate.js";

// ── Validate env ────────────────────────────────────────────────
const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error("[FATAL] DISCORD_TOKEN is not set in .env");
  process.exit(1);
}

// ── Bootstrap database ──────────────────────────────────────────
initializeDatabase();

// ── Create Discord client ───────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Collection that maps command-name → { data, execute }
client.commands = new Collection();

// ── Load commands from disk ─────────────────────────────────────
await loadCommands(client);

// ── Events ──────────────────────────────────────────────────────
// Use Events.ClientReady instead of 'ready' (deprecated in v15)
client.once(Events.ClientReady, () => handleReady(client));
client.on(Events.InteractionCreate, (interaction) =>
  handleInteraction(interaction, client),
);

// ── Login ───────────────────────────────────────────────────────
client.login(DISCORD_TOKEN);

// ── Graceful shutdown ───────────────────────────────────────────
const shutdown = () => {
  console.log("\n[BOT] Shutting down…");
  closeDatabase();
  client.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
