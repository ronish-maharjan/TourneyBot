// ─── src/utils/helpers.js ────────────────────────────────────────

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getTournamentByChannelId } from '../database/queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

export async function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const categories = fs.readdirSync(commandsPath);
  let count = 0;

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const fileUrl  = pathToFileURL(filePath).href;

      try {
        const mod = await import(fileUrl);
        if (mod.data && mod.execute) {
          client.commands.set(mod.data.name, mod);
          count++;
          console.log(`[CMD] Loaded: /${mod.data.name}`);
        } else {
          console.warn(`[CMD] Skipped ${file}: missing 'data' or 'execute' export`);
        }
      } catch (err) {
        console.error(`[CMD] Failed to load ${file}:`, err);
      }
    }
  }

  console.log(`[CMD] Total commands loaded: ${count}`);
}

export async function findTournamentByContext(channelId, parentId = null) {
  let tournament = await getTournamentByChannelId(channelId);
  if (!tournament && parentId) {
    tournament = await getTournamentByChannelId(parentId);
  }
  return tournament;
}

export function formatStatus(status) {
  const map = {
    created:             '📋 Created',
    registration_open:   '📝 Registration Open',
    registration_closed: '🔒 Registration Closed',
    in_progress:         '⚔️ In Progress',
    completed:           '✅ Completed',
    cancelled:           '❌ Cancelled',
  };
  return map[status] ?? status;
}

export function truncate(str, maxLen = 100) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

export function discordTimestamp(date, style = 'f') {
  const epoch = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${epoch}:${style}>`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

export async function safePin(message) {
  try {
    if (message.pinned) return;
    await message.pin();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const channel = message.channel;
    const recent  = await channel.messages.fetch({ limit: 5 });
    for (const [, msg] of recent) {
      if (msg.type === 6 && msg.reference?.messageId === message.id) {
        await msg.delete().catch(() => {});
        break;
      }
    }
  } catch (err) {
    console.warn('[PIN] Could not pin message:', err.message);
  }
}
