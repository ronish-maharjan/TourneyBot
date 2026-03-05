// ─── src/commands/user/match.js ──────────────────────────────────
// /match <tournament>  — Shows the user's current match details.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import {
  getTournamentById,
  getParticipant,
  getActiveMatchByPlayer,
  getPendingMatchesByPlayer,
  getMatchesByPlayer,
} from "../../database/queries.js";
import { COLORS } from "../../config.js";

export const data = new SlashCommandBuilder()
  .setName("match")
  .setDescription("Show your current match details")
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

  // Check if user is a participant
  const participant = getParticipant(tournamentId, interaction.user.id);
  if (!participant || participant.role !== "participant") {
    return interaction.reply({
      content: "❌ You are not a participant in this tournament.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Find active match
  const activeMatch = getActiveMatchByPlayer(tournamentId, interaction.user.id);

  if (activeMatch) {
    const opponentId =
      activeMatch.player1_id === interaction.user.id
        ? activeMatch.player2_id
        : activeMatch.player1_id;

    const opponentData = getParticipant(tournamentId, opponentId);
    const opponentName =
      opponentData?.display_name || opponentData?.username || "Unknown";

    const isPlayer1 = activeMatch.player1_id === interaction.user.id;
    const myScore = isPlayer1
      ? activeMatch.player1_score
      : activeMatch.player2_score;
    const opponentScore = isPlayer1
      ? activeMatch.player2_score
      : activeMatch.player1_score;
    const winsNeeded = Math.ceil(tournament.best_of / 2);

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Active Match — ${tournament.name}`)
      .setColor(COLORS.WARNING)
      .addFields(
        { name: "🔄 Round", value: `${activeMatch.round}`, inline: true },
        {
          name: "🏷️ Match #",
          value: `${activeMatch.match_number}`,
          inline: true,
        },
        { name: "📊 Status", value: "🟡 In Progress", inline: true },
        {
          name: "🆚 Opponent",
          value: `**${opponentName}** (<@${opponentId}>)`,
          inline: false,
        },
        {
          name: "📊 Score",
          value: `You: **${myScore}** — Opponent: **${opponentScore}**\n(First to **${winsNeeded}** wins)`,
          inline: false,
        },
      );

    // Thread link
    if (activeMatch.thread_id) {
      const threadUrl = `https://discord.com/channels/${interaction.guildId}/${activeMatch.thread_id}`;
      embed.addFields({
        name: "📌 Match Thread",
        value: `**[Click here to go to your match](${threadUrl})**`,
        inline: false,
      });
    }

    // Match history summary
    const allMatches = getMatchesByPlayer(tournamentId, interaction.user.id);
    const completed = allMatches.filter((m) => m.status === "completed");
    const pending = allMatches.filter((m) => m.status === "pending");
    const inProgress = allMatches.filter((m) => m.status === "in_progress");

    embed.addFields({
      name: "📈 Your Progress",
      value:
        `✅ Completed: **${completed.length}** · 🟡 Active: **${inProgress.length}** · ⏳ Pending: **${pending.length}**\n` +
        `📊 Record: **${participant.wins}**W / **${participant.losses}**L / **${participant.draws}**D · **${participant.points}** pts`,
      inline: false,
    });

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  // No active match — check for pending matches
  const pendingMatches = getPendingMatchesByPlayer(
    tournamentId,
    interaction.user.id,
  );

  if (pendingMatches.length > 0) {
    const next = pendingMatches[0];
    const opponentId =
      next.player1_id === interaction.user.id
        ? next.player2_id
        : next.player1_id;

    const opponentData = getParticipant(tournamentId, opponentId);
    const opponentName =
      opponentData?.display_name || opponentData?.username || "Unknown";

    const embed = new EmbedBuilder()
      .setTitle(`⏳ Next Match — ${tournament.name}`)
      .setColor(COLORS.NEUTRAL)
      .setDescription(
        "Your next match hasn't started yet. You'll be notified via DM when it begins!",
      )
      .addFields(
        { name: "🔄 Round", value: `${next.round}`, inline: true },
        { name: "🏷️ Match #", value: `${next.match_number}`, inline: true },
        {
          name: "🆚 Opponent",
          value: `**${opponentName}** (<@${opponentId}>)`,
          inline: false,
        },
      );

    // Remaining matches list
    if (pendingMatches.length > 1) {
      const upcoming = pendingMatches.slice(1, 4).map((m) => {
        const oppId =
          m.player1_id === interaction.user.id ? m.player2_id : m.player1_id;
        const oppData = getParticipant(tournamentId, oppId);
        const oppName = oppData?.display_name || oppData?.username || "Unknown";
        return `　R${m.round} #${m.match_number} vs **${oppName}**`;
      });

      if (pendingMatches.length > 4) {
        upcoming.push(`　*…and ${pendingMatches.length - 4} more*`);
      }

      embed.addFields({
        name: `📋 Upcoming (${pendingMatches.length} remaining)`,
        value: upcoming.join("\n"),
        inline: false,
      });
    }

    // Current stats
    embed.addFields({
      name: "📊 Your Stats",
      value: `**${participant.wins}**W / **${participant.losses}**L / **${participant.draws}**D · **${participant.points}** pts · **${participant.matches_played}** played`,
      inline: false,
    });

    embed.setFooter({ text: `${pendingMatches.length} match(es) remaining` });

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  // No pending matches — show summary
  const allMatches = getMatchesByPlayer(tournamentId, interaction.user.id);
  const completed = allMatches.filter((m) => m.status === "completed").length;

  const embed = new EmbedBuilder()
    .setTitle(`✅ All Matches Complete — ${tournament.name}`)
    .setColor(COLORS.SUCCESS)
    .setDescription("You have no upcoming or active matches.")
    .addFields({
      name: "📊 Final Stats",
      value:
        `🎮 **Matches Played:** ${completed}\n` +
        `✅ **Wins:** ${participant.wins} · ❌ **Losses:** ${participant.losses} · 🤝 **Draws:** ${participant.draws}\n` +
        `⭐ **Points:** ${participant.points}`,
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
