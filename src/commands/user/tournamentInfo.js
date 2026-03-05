// ─── src/commands/user/tournamentInfo.js ─────────────────────────
// /tournament-info <tournament>  — Show detailed tournament info.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import {
  getTournamentById,
  getParticipantCount,
  getActiveParticipantCount,
  getCompletedMatchCount,
  getTotalMatchCount,
  getLeaderboard,
  getParticipant,
} from "../../database/queries.js";
import { COLORS } from "../../config.js";
import { formatStatus, discordTimestamp } from "../../utils/helpers.js";

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
  const progressPct =
    totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setColor(COLORS.INFO)
    .addFields(
      {
        name: "📊 Status",
        value: formatStatus(tournament.status),
        inline: true,
      },
      { name: "🔄 Format", value: "Round Robin", inline: true },
      { name: "🎯 Best Of", value: `${tournament.best_of}`, inline: true },
      {
        name: "👤 Team Size",
        value: tournament.team_size === 1 ? "Solo" : "Duo",
        inline: true,
      },
      { name: "👥 Max", value: `${tournament.max_players}`, inline: true },
      {
        name: "📅 Created",
        value: discordTimestamp(tournament.created_at, "R"),
        inline: true,
      },
    );

  // Player stats
  embed.addFields({
    name: "👥 Players",
    value: `${activeCount} active / ${participantCount} registered / ${tournament.max_players} max`,
    inline: false,
  });

  // Match progress
  if (totalMatches > 0) {
    const progressBar = buildProgressBar(progressPct);
    embed.addFields(
      {
        name: "⚔️ Match Progress",
        value: `${progressBar} ${progressPct}%\n${completedMatches} / ${totalMatches} matches completed`,
        inline: false,
      },
      {
        name: "🔄 Round",
        value: `${tournament.current_round} / ${tournament.total_rounds}`,
        inline: true,
      },
    );
  }

  // Show top 3 if tournament is in progress or completed
  if (["in_progress", "completed"].includes(tournament.status)) {
    const leaderboard = getLeaderboard(tournamentId);
    if (leaderboard.length > 0) {
      const medals = ["🥇", "🥈", "🥉"];
      const top3 = leaderboard.slice(0, 3);
      const lines = top3.map((p, i) => {
        const dq = p.status === "disqualified" ? " *(DQ)*" : "";
        return `${medals[i]} <@${p.user_id}>${dq} — **${p.points}** pts (${p.wins}W/${p.losses}L)`;
      });

      embed.addFields({
        name: "🏅 Top 3",
        value: lines.join("\n"),
        inline: false,
      });
    }
  }

  // Show user's own standing if they're a participant
  const userParticipant = getParticipant(tournamentId, interaction.user.id);
  if (userParticipant && userParticipant.role === "participant") {
    const leaderboard = getLeaderboard(tournamentId);
    const rank =
      leaderboard.findIndex((l) => l.user_id === interaction.user.id) + 1;

    embed.addFields({
      name: "📋 Your Standing",
      value:
        `🏅 **Rank:** #${rank || "—"}\n` +
        `⭐ **Points:** ${userParticipant.points}\n` +
        `✅ ${userParticipant.wins}W · ❌ ${userParticipant.losses}L · 🤝 ${userParticipant.draws}D · 🎮 ${userParticipant.matches_played} played`,
      inline: false,
    });
  }

  // Rules
  if (tournament.rules && tournament.rules.trim().length > 0) {
    embed.addFields({
      name: "📜 Rules",
      value: tournament.rules.substring(0, 1024),
    });
  }

  // Channel links
  const links = [];
  if (tournament.admin_channel_id)
    links.push(`🛡️ <#${tournament.admin_channel_id}>`);
  if (tournament.registration_channel_id)
    links.push(`📋 <#${tournament.registration_channel_id}>`);
  if (tournament.leaderboard_channel_id)
    links.push(`📊 <#${tournament.leaderboard_channel_id}>`);
  if (tournament.bracket_channel_id)
    links.push(`🔀 <#${tournament.bracket_channel_id}>`);
  if (tournament.match_channel_id)
    links.push(`⚔️ <#${tournament.match_channel_id}>`);

  if (links.length > 0) {
    embed.addFields({
      name: "🔗 Channels",
      value: links.join(" · "),
      inline: false,
    });
  }

  embed.setFooter({ text: `ID: ${tournament.id}` }).setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Build a text-based progress bar.
 * @param {number} pct  0–100
 * @returns {string}
 */
function buildProgressBar(pct) {
  const total = 10;
  const filled = Math.round((pct / 100) * total);
  const empty = total - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}
