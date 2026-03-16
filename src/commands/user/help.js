// ─── src/commands/user/help.js ───────────────────────────────────
// /help [category] — Shows all bot commands organized by category.

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { COLORS } from '../../config.js';

// ── Command Categories ───────────────────────────────────────────

const CATEGORIES = {
  overview: {
    emoji: '🏠',
    label: 'Overview',
    description: 'Bot overview and navigation',
  },
  tournament: {
    emoji: '🏆',
    label: 'Tournament',
    description: 'Tournament creation and management',
  },
  match: {
    emoji: '⚔️',
    label: 'Matches',
    description: 'Match information and participation',
  },
  roles: {
    emoji: '🎭',
    label: 'Roles',
    description: 'Role management and auto-roles',
  },
  utility: {
    emoji: '🔧',
    label: 'Utility',
    description: 'General utility commands',
  },
};

// ── Category Embeds ──────────────────────────────────────────────

function buildOverviewEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Bot Help')
    .setColor(COLORS.PRIMARY)
    .setDescription(
      'A powerful tournament management bot for Discord.\n' +
      'Use the buttons below to browse commands by category.\n\n' +
      '**Categories:**',
    )
    .addFields(
      {
        name: '🏆 Tournament',
        value: 'Create, configure, and manage tournaments with automated brackets, leaderboards, and match scheduling.',
        inline: false,
      },
      {
        name: '⚔️ Matches',
        value: 'View your matches, check tournament progress, and track your stats.',
        inline: false,
      },
      {
        name: '🎭 Roles',
        value: 'Auto-assign roles to new members, and quickly give or remove roles.',
        inline: false,
      },
      {
        name: '🔧 Utility',
        value: 'Dice rolls, channel cleanup, and tournament display refresh.',
        inline: false,
      },
    )
    .setFooter({ text: 'Click a button below to see commands in each category' })
    .setTimestamp();
}

function buildTournamentEmbed() {
  return new EmbedBuilder()
    .setTitle('🏆 Tournament Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Commands for creating and managing tournaments.')
    .addFields(
      {
        name: '📌 Admin Commands',
        value:
          '> `/create <name>`\n' +
          '> Create a new tournament with channels, roles, and admin panel.\n\n' +
          '> `/register <user>`\n' +
          '> Register a player directly into the tournament (admin only).\n\n' +
          '> `/disqualify <user> [reason]`\n' +
          '> Disqualify a participant. All their matches are forfeited.\n\n' +
          '> `/refresh`\n' +
          '> Force refresh all tournament displays (leaderboard, bracket, etc).',
        inline: false,
      },
      {
        name: '🛡️ Admin Panel Buttons',
        value:
          '> `⚙️ Configure` — Set name, max players, team size, best-of, rules\n' +
          '> `📝 Open Registration` — Open registration with buttons\n' +
          '> `🔒 Close Registration` — Close registration\n' +
          '> `🚀 Start Tournament` — Generate matches and start\n' +
          '> `🏁 End Early` — End tournament and declare standings\n' +
          '> `🗑️ Delete` — Delete all channels, roles, and data',
        inline: false,
      },
      {
        name: '📋 Registration Buttons',
        value:
          '> `✅ Register` — Join as a participant\n' +
          '> `❌ Unregister` — Leave the tournament\n' +
          '> `👁️ Spectate` — Join as a spectator',
        inline: false,
      },
      {
        name: '📂 Auto-Created Channels',
        value:
          '`#leaderboard` — Live standings image\n' +
          '`#admin` — Admin panel (organizers only)\n' +
          '`#notice` — Announcements with @everyone\n' +
          '`#rules` — Tournament rules\n' +
          '`#registration` — Register/unregister buttons\n' +
          '`#participation` — Live participant list\n' +
          '`#bracket` — Match bracket image\n' +
          '`#result` — Match results\n' +
          '`#chat` — Participant chat\n' +
          '`#matches` — Match threads',
        inline: false,
      },
    )
    .setFooter({ text: 'Tournament Organizer role or Server Owner required for admin commands' })
    .setTimestamp();
}

function buildMatchEmbed() {
  return new EmbedBuilder()
    .setTitle('⚔️ Match Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Commands for viewing match information and tournament progress.')
    .addFields(
      {
        name: '👤 Player Commands',
        value:
          '> `/tournaments`\n' +
          '> List all active tournaments in this server.\n\n' +
          '> `/tournament-info <tournament>`\n' +
          '> View detailed tournament info, standings, and your rank.\n\n' +
          '> `/match <tournament>`\n' +
          '> View your current match details with thread link.',
        inline: false,
      },
      {
        name: '📝 Match Thread Buttons (Admin)',
        value:
          '> `📝 Add Score` — Record a game result (enter 1 or 2 for winner)\n' +
          '> `⛔ Disqualify` — Disqualify a player from the match',
        inline: false,
      },
      {
        name: '🔄 Match Flow',
        value:
          '```\n' +
          'Tournament Starts\n' +
          '  → Round 1 threads created\n' +
          '  → Players notified via DM\n' +
          '  → Admin records scores\n' +
          '  → Round completes → next round starts\n' +
          '  → All rounds done → winner declared\n' +
          '```',
        inline: false,
      },
      {
        name: '📊 Scoring',
        value:
          '> **Win:** +3 points\n' +
          '> **Loss:** +0 points\n' +
          '> **Draw:** +1 point\n\n' +
          '> Best-of-1 or Best-of-3 supported.',
        inline: false,
      },
    )
    .setFooter({ text: 'Match results update leaderboard and bracket automatically' })
    .setTimestamp();
}

function buildRolesEmbed() {
  return new EmbedBuilder()
    .setTitle('🎭 Role Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Commands for managing roles and auto-role on join.')
    .addFields(
      {
        name: '🤖 Auto-Role (on member join)',
        value:
          '> `/autorole add <role>`\n' +
          '> Add a role to auto-assign when new members join.\n\n' +
          '> `/autorole remove <role>`\n' +
          '> Remove a role from the auto-assign list.\n\n' +
          '> `/autorole list`\n' +
          '> Show all currently configured auto-roles.\n\n' +
          '> `/autorole clear`\n' +
          '> Remove all auto-roles.',
        inline: false,
      },
      {
        name: '⚡ Quick Role Management',
        value:
          '> `/giverole <user> <role>`\n' +
          '> Assign a role to a user.\n\n' +
          '> `/removerole <user> <role>`\n' +
          '> Remove a role from a user.',
        inline: false,
      },
      {
        name: '🔒 Permissions',
        value:
          '> **Auto-role:** Requires `Manage Roles` permission\n' +
          '> **Give/Remove:** Requires `Manage Roles` permission\n' +
          '> **List:** Available to everyone\n\n' +
          '> ⚠️ Bot\'s role must be **higher** than the role being assigned.',
        inline: false,
      },
    )
    .setFooter({ text: 'Max 10 auto-roles per server' })
    .setTimestamp();
}

function buildUtilityEmbed() {
  return new EmbedBuilder()
    .setTitle('🔧 Utility Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('General utility commands available in the server.')
    .addFields(
      {
        name: '🎲 Fun',
        value:
          '> `/roll`\n' +
          '> Roll a classic dice (1–6). Public result for fairness.',
        inline: false,
      },
      {
        name: '🧹 Moderation',
        value:
          '> `/clean <amount> [user] [bot_only]`\n' +
          '> Delete messages in the current channel.\n\n' +
          '> **Options:**\n' +
          '> `amount` — Number of messages (1–100)\n' +
          '> `user` — Only delete messages from this user\n' +
          '> `bot_only` — Only delete bot messages\n\n' +
          '> ⚠️ Requires `Manage Messages` in the channel.\n' +
          '> 📌 Pinned messages are never deleted.',
        inline: false,
      },
      {
        name: '🔄 Tournament Utility',
        value:
          '> `/refresh`\n' +
          '> Force refresh all tournament displays.\n' +
          '> Recreates deleted bot messages automatically.',
        inline: false,
      },
      {
        name: '📖 Help',
        value:
          '> `/help`\n' +
          '> Shows this help menu.',
        inline: false,
      },
    )
    .setFooter({ text: 'Use /help to see this menu anytime' })
    .setTimestamp();
}

// ── Category → Embed Map ─────────────────────────────────────────

const EMBED_BUILDERS = {
  overview:   buildOverviewEmbed,
  tournament: buildTournamentEmbed,
  match:      buildMatchEmbed,
  roles:      buildRolesEmbed,
  utility:    buildUtilityEmbed,
};

// ── Build Navigation Buttons ─────────────────────────────────────

function buildHelpButtons(activeCategory = 'overview') {
  const row = new ActionRowBuilder();

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const isActive = key === activeCategory;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${key}`)
        .setLabel(cat.label)
        .setEmoji(cat.emoji)
        .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(isActive),
    );
  }

  return row;
}

// ── Slash Command ────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show bot commands and features');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const embed   = buildOverviewEmbed();
  const buttons = buildHelpButtons('overview');

  await interaction.reply({
    embeds: [embed],
    components: [buttons],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Exported for button handler ──────────────────────────────────

export { EMBED_BUILDERS, buildHelpButtons };
