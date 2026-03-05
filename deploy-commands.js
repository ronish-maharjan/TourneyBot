// ─── deploy-commands.js ──────────────────────────────────────────
// Reads every command file under src/commands/ and registers them
// with the Discord API.  Run: npm run deploy

import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("[FATAL] DISCORD_TOKEN and CLIENT_ID must be set in .env");
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, "src", "commands");

// Walk each sub-folder (admin/, user/) and import command modules
const categories = fs.readdirSync(commandsPath);

for (const category of categories) {
  const catPath = path.join(commandsPath, category);
  if (!fs.statSync(catPath).isDirectory()) continue;

  const files = fs.readdirSync(catPath).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    const filePath = path.join(catPath, file);
    const mod = await import(pathToFileURL(filePath).href);

    if (mod.data) {
      commands.push(mod.data.toJSON());
      console.log(`[DEPLOY] Loaded: /${mod.data.name}`);
    } else {
      console.warn(`[DEPLOY] Skipped ${file}: no 'data' export`);
    }
  }
}

// Push to Discord
const rest = new REST().setToken(DISCORD_TOKEN);

try {
  console.log(`[DEPLOY] Registering ${commands.length} slash command(s)…`);

  if (GUILD_ID) {
    // Guild-scoped — instant, ideal for development
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("[DEPLOY] ✅ Guild commands registered.");
  } else {
    // Global — can take up to 1 hour
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("[DEPLOY] ✅ Global commands registered.");
  }
} catch (err) {
  console.error("[DEPLOY] ❌ Failed:", err);
  process.exit(1);
}
