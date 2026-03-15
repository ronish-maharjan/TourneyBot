// ─── src/commands/user/clean.js ──────────────────────────────────
// /clean <amount> [user] [bot_only]
// Deletes messages in the current channel.
// Requires ManageMessages permission in the channel (per-channel or server-wide).

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('clean')
  .setDescription('Delete messages in this channel')
  .addIntegerOption(opt =>
    opt
      .setName('amount')
      .setDescription('Number of messages to delete (1–100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('Only delete messages from this user')
      .setRequired(false),
  )
  .addBooleanOption(opt =>
    opt
      .setName('bot_only')
      .setDescription('Only delete bot messages')
      .setRequired(false),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  // ── Guild only ─────────────────────────────────────────────
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Check user has ManageMessages in THIS channel ──────────
  const memberPerms = interaction.channel.permissionsFor(interaction.member);
  if (!memberPerms?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({
      content: '❌ You don\'t have permission to manage messages in this channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Check bot has ManageMessages in THIS channel ───────────
  const botPerms = interaction.channel.permissionsFor(interaction.guild.members.me);
  if (!botPerms?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({
      content: '❌ I don\'t have permission to manage messages in this channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const amount     = interaction.options.getInteger('amount', true);
  const targetUser = interaction.options.getUser('user');
  const botOnly    = interaction.options.getBoolean('bot_only') ?? false;

  // ── Cannot use both user and bot_only ──────────────────────
  if (targetUser && botOnly) {
    return interaction.reply({
      content: '❌ You cannot use both `user` and `bot_only` at the same time.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // ── Fetch messages ─────────────────────────────────────────
    // Fetch more than needed to account for filtering + pinned
    const fetchLimit = Math.min(amount * 2, 100);
    const fetched    = await interaction.channel.messages.fetch({ limit: fetchLimit });

    // ── Filter messages ────────────────────────────────────────
    let toDelete = [...fetched.values()];

    // Skip pinned messages
    toDelete = toDelete.filter(msg => !msg.pinned);

    // Skip messages older than 14 days (Discord bulk delete limit)
    const fourteenDays = Date.now() - (14 * 24 * 60 * 60 * 1000);
    toDelete = toDelete.filter(msg => msg.createdTimestamp > fourteenDays);

    // Filter by target user
    if (targetUser) {
      toDelete = toDelete.filter(msg => msg.author.id === targetUser.id);
    }

    // Filter bot messages only
    if (botOnly) {
      toDelete = toDelete.filter(msg => msg.author.bot);
    }

    // Limit to requested amount
    toDelete = toDelete.slice(0, amount);

    if (toDelete.length === 0) {
      return interaction.editReply({
        content: '📭 No messages found matching your criteria.',
      });
    }

    // ── Delete messages ────────────────────────────────────────
    let deletedCount = 0;

    if (toDelete.length === 1) {
      // Single message — use direct delete
      await toDelete[0].delete();
      deletedCount = 1;
    } else {
      // Bulk delete (2–100 messages)
      const deleted = await interaction.channel.bulkDelete(toDelete, true);
      deletedCount = deleted.size;
    }

    // ── Build result ───────────────────────────────────────────
    let description = `🗑️ Deleted **${deletedCount}** message(s)`;

    if (targetUser) {
      description += ` from **${targetUser.displayName}**`;
    } else if (botOnly) {
      description += ' (bot messages only)';
    }

    const embed = new EmbedBuilder()
      .setTitle('🧹 Channel Cleaned')
      .setColor(COLORS.SUCCESS)
      .setDescription(description)
      .setFooter({ text: `Requested by ${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    console.error('[CLEAN]', err);

    let errorMsg = `❌ Failed to delete messages: ${err.message}`;

    // Common error: messages too old
    if (err.code === 50034) {
      errorMsg = '❌ Some messages are older than 14 days and cannot be bulk deleted.';
    }

    await interaction.editReply({ content: errorMsg });
  }
}
