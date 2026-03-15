// ─── src/commands/admin/refresh.js ───────────────────────────────
// /refresh — Force refresh all tournament embeds, images, and panels
// in the current tournament's channels.

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { findTournamentByContext } from '../../utils/helpers.js';
import { getTournamentById } from '../../database/queries.js';
import { COLORS } from '../../config.js';
import {
  refreshAdminPanel,
  refreshRegistrationMessage,
  refreshParticipationList,
  refreshLeaderboard,
  refreshBracket,
  refreshRules,
} from '../../services/tournamentService.js';

export const data = new SlashCommandBuilder()
  .setName('refresh')
  .setDescription('Force refresh all tournament displays (admin only)');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!isOrganizer(interaction.member)) {
    return interaction.reply({
      content: '❌ Only organisers can refresh tournament displays.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Find tournament by channel context ─────────────────────
  const tournament = findTournamentByContext(
    interaction.channelId,
    interaction.channel?.parentId,
  );

  if (!tournament) {
    return interaction.reply({
      content: '❌ Run this command inside a tournament channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fresh   = getTournamentById(tournament.id);
  const results = [];

  // ── Refresh each component ─────────────────────────────────
  try {
    await refreshAdminPanel(interaction.guild, fresh);
    results.push('✅ Admin Panel');
  } catch {
    results.push('❌ Admin Panel');
  }

  try {
    await refreshRegistrationMessage(interaction.guild, fresh);
    results.push('✅ Registration');
  } catch {
    results.push('❌ Registration');
  }

  try {
    await refreshParticipationList(interaction.guild, fresh);
    results.push('✅ Participation List');
  } catch {
    results.push('❌ Participation List');
  }

  try {
    await refreshLeaderboard(interaction.guild, fresh);
    results.push('✅ Leaderboard');
  } catch {
    results.push('❌ Leaderboard');
  }

  try {
    await refreshBracket(interaction.guild, fresh);
    results.push('✅ Bracket');
  } catch {
    results.push('❌ Bracket');
  }

  try {
    await refreshRules(interaction.guild, fresh);
    results.push('✅ Rules');
  } catch {
    results.push('❌ Rules');
  }

  const embed = new EmbedBuilder()
    .setTitle('🔄 Tournament Refreshed')
    .setColor(COLORS.SUCCESS)
    .setDescription(
      `All displays for **${fresh.name}** have been refreshed.\n` +
      `Any deleted messages have been recreated.\n\n` +
      results.join('\n'),
    )
    .setFooter({ text: 'Missing messages are automatically recreated' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
