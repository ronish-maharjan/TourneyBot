// ─── src/commands/user/tournamentInfo.js ─────────────────────────
// /tournament-info <tournament>  — Show details for a tournament.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import {
  getTournamentById,
  getParticipantCount,
  getActiveParticipantCount,
  getCompletedMatchCount,
  getTotalMatchCount,
} from "../../database/queries.js";
import { COLORS } from "../../config.js";
import { formatStatus } from "../../utils/helpers.js";

export const data = new SlashCommandBuilder()
  .setName("tournament-info")
  .setDescription("Show details about a tournament")
  .addStringOption((opt) =>
    opt
      .setName("tournament")
      .setDescription("Select a tournament")
      .setRequired(true)
      .setAutocomplete(true),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournamentId = interaction.options.getString("tournament", true);
  const tournament = getTournamentById(tournamentId);

  if (!tournament || tournament.guild_id !== interaction.guildId) {
    return interaction.reply({
      content: "❌ Tournament not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const participantCount = getParticipantCount(tournamentId);
  const activeCount = getActiveParticipantCount(tournamentId);
  const completedMatches = getCompletedMatchCount(tournamentId);
  const totalMatches = getTotalMatchCount(tournamentId);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setColor(COLORS.INFO)
    .addFields(
      { name: "Status", value: formatStatus(tournament.status), inline: true },
      { name: "Format", value: "Round Robin", inline: true },
      { name: "Best Of", value: `${tournament.best_of}`, inline: true },
      {
        name: "Team Size",
        value: tournament.team_size === 1 ? "Solo" : "Duo",
        inline: true,
      },
      {
        name: "Players",
        value: `${activeCount} active / ${participantCount} registered / ${tournament.max_players} max`,
        inline: false,
      },
      {
        name: "Matches",
        value:
          totalMatches > 0
            ? `${completedMatches} / ${totalMatches}`
            : "Not started",
        inline: true,
      },
      {
        name: "Round",
        value:
          tournament.total_rounds > 0
            ? `${tournament.current_round} / ${tournament.total_rounds}`
            : "N/A",
        inline: true,
      },
    );

  // Show rules if they exist
  if (tournament.rules && tournament.rules.trim().length > 0) {
    embed.addFields({
      name: "📜 Rules",
      value: tournament.rules.substring(0, 1024),
    });
  }

  embed.setFooter({ text: `ID: ${tournament.id}` }).setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
