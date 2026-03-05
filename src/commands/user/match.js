// ─── src/commands/user/match.js ──────────────────────────────────
// /match <tournament>  — Shows the user's current match details.

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import {
  getTournamentById,
  getParticipant,
  getActiveMatchByPlayer,
  getPendingMatchesByPlayer,
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

    const isPlayer1 = activeMatch.player1_id === interaction.user.id;
    const myScore = isPlayer1
      ? activeMatch.player1_score
      : activeMatch.player2_score;
    const opponentScore = isPlayer1
      ? activeMatch.player2_score
      : activeMatch.player1_score;

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Active Match — ${tournament.name}`)
      .setColor(COLORS.WARNING)
      .addFields(
        { name: "Round", value: `${activeMatch.round}`, inline: true },
        { name: "Match #", value: `${activeMatch.match_number}`, inline: true },
        { name: "Status", value: "🟡 In Progress", inline: true },
        { name: "Opponent", value: `<@${opponentId}>`, inline: false },
        {
          name: "Score",
          value: `You: ${myScore} — Opponent: ${opponentScore}`,
          inline: false,
        },
      );

    if (activeMatch.thread_id) {
      embed.addFields({
        name: "Match Thread",
        value: `<#${activeMatch.thread_id}>`,
      });
    }

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

    const embed = new EmbedBuilder()
      .setTitle(`⏳ Next Match — ${tournament.name}`)
      .setColor(COLORS.NEUTRAL)
      .setDescription(
        "Your next match hasn't started yet. You'll be notified when it begins.",
      )
      .addFields(
        { name: "Round", value: `${next.round}`, inline: true },
        { name: "Match #", value: `${next.match_number}`, inline: true },
        { name: "Opponent", value: `<@${opponentId}>`, inline: false },
      )
      .setFooter({ text: `${pendingMatches.length} match(es) remaining` });

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  // No matches at all
  await interaction.reply({
    content: "✅ You have no upcoming or active matches in this tournament.",
    flags: MessageFlags.Ephemeral,
  });
}
