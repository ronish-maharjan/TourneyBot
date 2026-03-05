// ─── src/commands/user/tournaments.js ────────────────────────────
// /tournaments  — Lists all active tournaments in the server.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { getActiveTournamentsByGuild } from "../../database/queries.js";
import { COLORS } from "../../config.js";
import { formatStatus } from "../../utils/helpers.js";

export const data = new SlashCommandBuilder()
  .setName("tournaments")
  .setDescription("List all active tournaments in this server");

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

  const tournaments = getActiveTournamentsByGuild(interaction.guildId);

  if (tournaments.length === 0) {
    return interaction.reply({
      content: "📭 There are no active tournaments in this server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 Active Tournaments")
    .setColor(COLORS.PRIMARY)
    .setDescription(
      tournaments
        .map((t, i) => {
          const status = formatStatus(t.status);
          return `**${i + 1}.** ${t.name}\n　Status: ${status} · Format: Round Robin · Players: ${t.max_players} max`;
        })
        .join("\n\n"),
    )
    .setFooter({ text: "Use /tournament-info for details" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
