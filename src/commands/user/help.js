// ─── src/commands/user/help.js ───────────────────────────────────
// /help — Shows all bot commands organized by category with button navigation.

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
  },
  tournament: {
    emoji: '🏆',
    label: 'Tournament',
  },
  match: {
    emoji: '⚔️',
    label: 'Matches',
  },
  giveaway: {
    emoji: '🎉',
    label: 'Giveaway',
  },
  roles: {
    emoji: '🎭',
    label: 'Roles',
  },
  utility: {
    emoji: '🔧',
    label: 'Utility',
  },
};

// ── Category Embeds ──────────────────────────────────────────────

function buildOverviewEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Bot Help')
    .setColor(COLORS.PRIMARY)
    .setDescription(
      'A powerful all-in-one Discord bot for tournament management, giveaways, role management, and server utilities.\n\n' +
      'Use the buttons below to browse commands by category.',
    )
    .addFields(
      {
        name: '🏆 Tournament',
        value: 'Create and manage round-robin tournaments with automated brackets, leaderboards, match scheduling, and scoring.',
      },
      {
        name: '⚔️ Matches',
        value: 'View your matches, check standings, and track your tournament progress.',
      },
      {
        name: '🎉 Giveaway',
        value: 'Create giveaways with staff approval, auto-end timer, entry tracking, and winner selection.',
      },
      {
        name: '🎭 Roles',
        value: 'Auto-assign roles to new members and quickly give/remove roles.',
      },
      {
        name: '🔧 Utility',
        value: 'Dice rolls, message cleanup, tournament refresh, and this help menu.',
      },
    )
    .setFooter({ text: 'Click a button below to see commands in each category' })
    .setTimestamp();
}

function buildTournamentEmbed() {
  return new EmbedBuilder()
    .setTitle('🏆 Tournament Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Complete tournament management with round-robin format.')
    .addFields(
      {
        name: '🔧 Admin Commands',
        value: [
          '> `/create <name>`',
          '> Create a new tournament with all channels and roles.',
          '',
          '> `/register <user>`',
          '> Register a player directly (works before and after reg opens).',
          '',
          '> `/disqualify <user> [reason]`',
          '> Disqualify a participant. All their matches are forfeited.',
          '',
          '> `/refresh`',
          '> Force refresh all tournament displays.',
        ].join('\n'),
      },
      {
        name: '🛡️ Admin Panel Buttons',
        value: [
          '`⚙️ Configure` — Name, max players, team size, best-of, rules',
          '`📝 Open Registration` — Publish registration with buttons',
          '`🔒 Close Registration` — Lock registration',
          '`🚀 Start Tournament` — Generate round-robin matches',
          '`🏁 End Early` — End and declare standings',
          '`🗑️ Delete` — Remove all channels, roles, and data',
        ].join('\n'),
      },
      {
        name: '📋 Registration Buttons',
        value: [
          '`✅ Register` — Join as a participant',
          '`❌ Unregister` — Leave the tournament',
          '`👁️ Spectate` — Watch matches and chat in threads',
        ].join('\n'),
      },
      {
        name: '📂 Auto-Created Channels (10)',
        value: [
          '`#leaderboard` — Live standings image',
          '`#admin` — Admin panel (organizers only)',
          '`#notice` — Announcements with @everyone',
          '`#rules` — Tournament rules (auto-updates)',
          '`#registration` — Register/unregister buttons',
          '`#participation` — Live participant list',
          '`#bracket` — Match bracket image',
          '`#result` — Match results',
          '`#chat` — Participant & spectator chat',
          '`#matches` — Match threads (one per match)',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Requires TournamentOrganizer role or Server Owner' })
    .setTimestamp();
}

function buildMatchEmbed() {
  return new EmbedBuilder()
    .setTitle('⚔️ Match Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Track matches and tournament progress.')
    .addFields(
      {
        name: '👤 Player Commands',
        value: [
          '> `/tournaments`',
          '> List all active tournaments in this server.',
          '',
          '> `/tournament-info <tournament>`',
          '> Detailed info — standings, your rank, channel links.',
          '',
          '> `/match <tournament>`',
          '> Your current match with thread link and stats.',
        ].join('\n'),
      },
      {
        name: '📝 Match Thread Buttons (Admin)',
        value: [
          '`📝 Add Score` — Record game result (enter 1 or 2 for winner)',
          '`⛔ Disqualify` — DQ a player with reason from match thread',
        ].join('\n'),
      },
      {
        name: '🔄 Match Flow',
        value: [
          '```',
          'Tournament Starts',
          '  └─ Round 1 threads created (players DM\'d)',
          '       └─ Admin records scores',
          '            └─ Round completes → Round 2 starts',
          '                 └─ All rounds done → Winner!',
          '```',
        ].join('\n'),
      },
      {
        name: '📊 Scoring System',
        value: [
          '> **Win:** +3 points  ·  **Loss:** +0 points  ·  **Draw:** +1 point',
          '> Best-of-1 or Best-of-3 supported',
          '> Leaderboard and bracket update automatically after each match',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Players get DM notifications for matches, results, and DQs' })
    .setTimestamp();
}

function buildGiveawayEmbed() {
  return new EmbedBuilder()
    .setTitle('🎉 Giveaway Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Create and manage giveaways with staff approval system.')
    .addFields(
      {
        name: '🔧 Admin Setup',
        value: [
          '> `/giveaway setup staff_role: channel: ping_role:`',
          '> Configure giveaway system — all options in one command.',
          '> Re-run to update any setting. All options are optional.',
          '',
          '> `/giveaway setup clear_ping:True`',
          '> Revert ping to @everyone.',
          '',
          '> `/giveaway removechannel <channel>`',
          '> Remove a giveaway channel.',
          '',
          '> `/giveaway config`',
          '> View current giveaway settings.',
        ].join('\n'),
      },
      {
        name: '🎁 Creating Giveaways (Anyone)',
        value: [
          '> `/giveaway create`',
          '> Opens a form to submit a giveaway:',
          '> • Prize name',
          '> • Description (optional)',
          '> • Duration (1–10080 minutes / up to 7 days)',
          '> • Number of winners (1–10)',
          '',
          '> Giveaway is sent to staff for approval via DM.',
        ].join('\n'),
      },
      {
        name: '👥 Staff Actions (via DM)',
        value: [
          '`✅ Approve` — Pick which channel to publish in',
          '`❌ Reject` — Enter rejection reason → creator notified',
          '',
          '> Staff receive DM with approve/reject buttons.',
          '> Only one staff member can process each giveaway.',
        ].join('\n'),
      },
      {
        name: '🏆 After Publishing',
        value: [
          '> Members click `🎉 Enter Giveaway` to enter.',
          '> Click again to leave. Entry count updates live.',
          '> Creator cannot enter their own giveaway.',
          '> Timer auto-ends and picks random winner(s).',
          '',
          '> `/giveaway end <id>` — End early (Staff)',
          '> `/giveaway reroll <id>` — Pick new winner (Staff)',
        ].join('\n'),
      },
      {
        name: '💡 Setup Example',
        value: [
          '```',
          '/giveaway setup staff_role:@GiveawayStaff channel:#giveaways ping_role:@GAPings',
          '```',
          'Then anyone can use `/giveaway create` to submit!',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Winners and creators are notified via DM' })
    .setTimestamp();
}

function buildRolesEmbed() {
  return new EmbedBuilder()
    .setTitle('🎭 Role Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('Manage roles and auto-assign on member join.')
    .addFields(
      {
        name: '🤖 Auto-Role (on member join)',
        value: [
          '> `/autorole add <role>`',
          '> Add a role to auto-assign when new members join.',
          '',
          '> `/autorole remove <role>`',
          '> Remove a role from auto-assign list.',
          '',
          '> `/autorole list`',
          '> Show all configured auto-roles.',
          '',
          '> `/autorole clear`',
          '> Remove all auto-roles.',
        ].join('\n'),
      },
      {
        name: '⚡ Quick Role Management',
        value: [
          '> `/giverole <user> <role>`',
          '> Assign a role to a user instantly.',
          '',
          '> `/removerole <user> <role>`',
          '> Remove a role from a user.',
        ].join('\n'),
      },
      {
        name: '🔒 Permissions & Limits',
        value: [
          '> • **Auto-role / Give / Remove:** Requires `Manage Roles`',
          '> • **List:** Available to everyone',
          '> • Bot\'s role must be **higher** than the target role',
          '> • Your role must be **higher** than the target role',
          '> • Max **10** auto-roles per server',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Auto-roles are assigned instantly when new members join' })
    .setTimestamp();
}

function buildUtilityEmbed() {
  return new EmbedBuilder()
    .setTitle('🔧 Utility Commands')
    .setColor(COLORS.PRIMARY)
    .setDescription('General utility commands for the server.')
    .addFields(
      {
        name: '🎲 Fun',
        value: [
          '> `/roll`',
          '> Roll a classic dice (1–6). Result is public for fairness.',
        ].join('\n'),
      },
      {
        name: '🧹 Message Cleanup',
        value: [
          '> `/clean <amount> [user] [bot_only]`',
          '> Delete messages in the current channel.',
          '',
          '> **Options:**',
          '> • `amount` — Number of messages to delete (1–100)',
          '> • `user` — Only delete messages from this user',
          '> • `bot_only` — Only delete bot messages',
          '',
          '> 📌 Pinned messages are never deleted.',
          '> ⏰ Messages older than 14 days cannot be bulk deleted.',
          '> 🔒 Requires `Manage Messages` permission in the channel.',
        ].join('\n'),
      },
      {
        name: '🔄 Tournament Utility',
        value: [
          '> `/refresh`',
          '> Force refresh all tournament displays.',
          '> Recreates deleted bot messages automatically.',
          '> Use in any tournament channel.',
        ].join('\n'),
      },
      {
        name: '📖 Help',
        value: [
          '> `/help`',
          '> Shows this help menu with category navigation.',
        ].join('\n'),
      },
    )
    .setFooter({ text: '/clean respects per-channel Manage Messages permissions' })
    .setTimestamp();
}

// ── Category → Embed Map ─────────────────────────────────────────

const EMBED_BUILDERS = {
  overview:   buildOverviewEmbed,
  tournament: buildTournamentEmbed,
  match:      buildMatchEmbed,
  giveaway:   buildGiveawayEmbed,
  roles:      buildRolesEmbed,
  utility:    buildUtilityEmbed,
};

// ── Build Navigation Buttons ─────────────────────────────────────

function buildHelpButtons(activeCategory = 'overview') {
  const keys = Object.keys(CATEGORIES);

  // Split into two rows if more than 5
  const row1Keys = keys.slice(0, 5);
  const row2Keys = keys.slice(5);

  const row1 = new ActionRowBuilder();
  for (const key of row1Keys) {
    const cat      = CATEGORIES[key];
    const isActive = key === activeCategory;

    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${key}`)
        .setLabel(cat.label)
        .setEmoji(cat.emoji)
        .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(isActive),
    );
  }

  const rows = [row1];

  if (row2Keys.length > 0) {
    const row2 = new ActionRowBuilder();
    for (const key of row2Keys) {
      const cat      = CATEGORIES[key];
      const isActive = key === activeCategory;

      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(`help_${key}`)
          .setLabel(cat.label)
          .setEmoji(cat.emoji)
          .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(isActive),
      );
    }
    rows.push(row2);
  }

  return rows;
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
    components: buttons,
    flags: MessageFlags.Ephemeral,
  });
}

// ── Exported for button handler ──────────────────────────────────

export { EMBED_BUILDERS, buildHelpButtons };
