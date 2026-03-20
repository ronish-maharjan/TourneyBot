import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Events } from 'discord.js';
import { initializeDatabase, closeDatabase } from './database/init.js';
import { loadCommands } from './utils/helpers.js';
import { handleReady } from './events/ready.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMemberJoin } from './events/guildMemberAdd.js';
import { startGiveawayTimer, stopGiveawayTimer } from './services/giveawayTimer.js';
import { cleanStaleLocks } from './services/lockService.js';
import { handleGuildCreate } from './events/guildCreate.js';
import http from 'http';
const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('[FATAL] DISCORD_TOKEN is not set in .env');
  process.exit(1);
}

// ── Bootstrap database (async now) ──────────────────────────────
await initializeDatabase();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
await loadCommands(client);

client.once(Events.ClientReady, () => {
  handleReady(client);
  startGiveawayTimer(client);
  setInterval(() => cleanStaleLocks(), 120_000);
});

client.on(Events.InteractionCreate, interaction => handleInteraction(interaction, client));
client.on(Events.GuildMemberAdd, member => handleMemberJoin(member));
client.on(Events.GuildCreate, guild => handleGuildCreate(guild));

client.login(DISCORD_TOKEN).catch(err => {
  console.error('[FATAL] Discord login failed:', err.message);
  process.exit(1);
});

client.on('error', err => console.error('[BOT] Client error:', err));

const shutdown = async () => {
  console.log('\n[BOT] Shutting down…');
  stopGiveawayTimer();
  await closeDatabase();
  client.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.createServer((req, res) => res.end('Bot is running')).listen(process.env.PORT || 3000);
