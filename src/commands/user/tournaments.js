// ─── src/commands/user/tournaments.js ────────────────────────────
// /tournaments  — Lists all active tournaments in the server.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import {
  getActiveTournamentsByGuild,
  getParticipantCount,
  getActiveParticipantCount,
  getCompletedMatchCount,
  getTotalMatchCount,
} from "../../database/queries.js";
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
    .setTimestamp();

  const lines = [];

  for (let i = 0; i < tournaments.length; i++) {
    const t = tournaments[i];
    const status = formatStatus(t.status);
    const registered = getParticipantCount(t.id);
    const active = getActiveParticipantCount(t.id);
    const completedM = getCompletedMatchCount(t.id);
    const totalM = getTotalMatchCount(t.id);
    const teamLabel = t.team_size === 1 ? "Solo" : "Duo";
    const progressPct =
      totalM > 0 ? Math.round((completedM / totalM) * 100) : 0;

    let matchLine = "";
    if (totalM > 0) {
      matchLine = `\n　⚔️ Matches: ${completedM}/${totalM} (${progressPct}%) · Round ${t.current_round}/${t.total_rounds}`;
    }

    lines.push(
      `**${i + 1}. ${t.name}**\n` +
        `　${status}\n` +
        `　👥 Players: ${active}/${t.max_players} · ${teamLabel} · Bo${t.best_of}` +
        matchLine,
    );
  }

  embed.setDescription(lines.join("\n\n"));
  embed.setFooter({
    text: `${tournaments.length} active tournament(s) · Use /tournament-info for details`,
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
