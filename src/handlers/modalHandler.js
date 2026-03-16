// ─── src/handlers/modalHandler.js ────────────────────────────────
// Routes modal-submit interactions by custom-ID prefix.

import { MessageFlags, EmbedBuilder } from "discord.js";
import {
  getTournamentById,
  updateTournamentConfig,
  getMatchById,
  getParticipant,
  updateMatchScore,
  updateMatchResult,
} from "../database/queries.js";
import {
  refreshAdminPanel,
  refreshRegistrationMessage,
  refreshRules,
} from '../services/tournamentService.js';
import { updateMatchThreadEmbed } from "../services/threadService.js";
import { processMatchCompletion } from "../services/matchService.js";
import {
  MAX_PLAYERS_LIMIT,
  VALID_BEST_OF,
  VALID_TEAM_SIZES,
  TOURNAMENT_STATUS,
  MATCH_STATUS,
  COLORS,
} from "../config.js";

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleModal(interaction) {
  const [prefix, action, ...rest] = interaction.customId.split("_");
  const targetId = rest.join("_");

  if (prefix !== "modal") {
    console.warn(
      `[MODAL] Unexpected prefix: ${prefix} (${interaction.customId})`,
    );
    return interaction.reply({
      content: "❓ Unknown modal.",
      flags: MessageFlags.Ephemeral,
    });
  }

  switch (action) {
    case "configure":
      return handleConfigureSubmit(interaction, targetId);
    case "score":
      return handleScoreSubmit(interaction, targetId);
    case "dq":
      return handleDqSubmit(interaction, targetId); // ← ADD

    default:
      console.warn(
        `[MODAL] Unknown action: ${action} (${interaction.customId})`,
      );
      await interaction.reply({
        content: "❓ Unknown modal action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ═════════════════════════════════════════════════════════════════
//  CONFIGURE MODAL SUBMIT
// ═════════════════════════════════════════════════════════════════

async function handleConfigureSubmit(interaction, tournamentId) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) {
    return interaction.reply({
      content: "❌ Tournament not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (
    [
      TOURNAMENT_STATUS.IN_PROGRESS,
      TOURNAMENT_STATUS.COMPLETED,
      TOURNAMENT_STATUS.CANCELLED,
    ].includes(tournament.status)
  ) {
    return interaction.reply({
      content:
        "❌ Cannot configure a tournament that has already started or ended.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const name = interaction.fields.getTextInputValue("tournament_name").trim();
  const maxStr = interaction.fields.getTextInputValue("max_players").trim();
  const teamStr = interaction.fields.getTextInputValue("team_size").trim();
  const bestStr = interaction.fields.getTextInputValue("best_of").trim();
  const rules = interaction.fields.getTextInputValue("rules")?.trim() || "";

  const errors = [];

  if (name.length < 2 || name.length > 50) {
    errors.push("• **Name** must be 2–50 characters.");
  }

  const maxPlayers = parseInt(maxStr, 10);
  if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS_LIMIT) {
    errors.push(
      `• **Max Players** must be a number between 2 and ${MAX_PLAYERS_LIMIT}.`,
    );
  }

  const teamSize = parseInt(teamStr, 10);
  if (!VALID_TEAM_SIZES.includes(teamSize)) {
    errors.push(
      `• **Team Size** must be one of: ${VALID_TEAM_SIZES.join(", ")}.`,
    );
  }

  const bestOf = parseInt(bestStr, 10);
  if (!VALID_BEST_OF.includes(bestOf)) {
    errors.push(`• **Best Of** must be one of: ${VALID_BEST_OF.join(", ")}.`);
  }

  if (rules.length > 1000) {
    errors.push("• **Rules** must be 1000 characters or fewer.");
  }

  if (errors.length > 0) {
    return interaction.reply({
      content: `❌ **Validation errors:**\n${errors.join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    updateTournamentConfig(tournament.id, {
      name,
      maxPlayers,
      teamSize,
      bestOf,
      rules,
    });

    const fresh = getTournamentById(tournament.id);
    await refreshAdminPanel(interaction.guild, fresh);
    await refreshRules(interaction.guild, fresh);

    if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
      await refreshRegistrationMessage(interaction.guild, fresh);
    }

    await interaction.editReply({
      content:
        `✅ Tournament configuration updated!\n\n` +
        `📝 **Name:** ${name}\n` +
        `👥 **Max Players:** ${maxPlayers}\n` +
        `👤 **Team Size:** ${teamSize === 1 ? "Solo" : "Duo"}\n` +
        `🎯 **Best Of:** ${bestOf}\n` +
        `📜 **Rules:** ${rules || "None"}`,
    });
  } catch (err) {
    console.error("[CONFIGURE]", err);
    await interaction.editReply({
      content: `❌ Failed to update configuration: ${err.message}`,
    });
  }
}

// ═════════════════════════════════════════════════════════════════
//  SCORE MODAL SUBMIT
// ═════════════════════════════════════════════════════════════════

async function handleScoreSubmit(interaction, matchIdStr) {
  const matchId = parseInt(matchIdStr, 10);

  const match = getMatchById(matchId);
  if (!match) {
    return interaction.reply({
      content: "❌ Match not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (match.status === "completed") {
    return interaction.reply({
      content: "❌ This match is already completed.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (match.status === "cancelled") {
    return interaction.reply({
      content: "❌ This match has been cancelled.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournament = getTournamentById(match.tournament_id);
  if (!tournament) {
    return interaction.reply({
      content: "❌ Tournament not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const winnerInput = interaction.fields.getTextInputValue("winner").trim();

  if (winnerInput !== "1" && winnerInput !== "2") {
    return interaction.reply({
      content:
        "❌ Invalid input. Enter **1** or **2** to select the game winner.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const gameWinnerId =
    winnerInput === "1" ? match.player1_id : match.player2_id;

  let newP1Score = match.player1_score;
  let newP2Score = match.player2_score;

  if (gameWinnerId === match.player1_id) {
    newP1Score += 1;
  } else {
    newP2Score += 1;
  }

  const p1Data = getParticipant(tournament.id, match.player1_id);
  const p2Data = getParticipant(tournament.id, match.player2_id);
  const p1Name = p1Data?.display_name || p1Data?.username || "Player 1";
  const p2Name = p2Data?.display_name || p2Data?.username || "Player 2";
  const gameWinnerName = gameWinnerId === match.player1_id ? p1Name : p2Name;

  const winsNeeded = Math.ceil(tournament.best_of / 2);
  const isCompleted = newP1Score >= winsNeeded || newP2Score >= winsNeeded;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (isCompleted) {
      const matchWinnerId =
        newP1Score >= winsNeeded ? match.player1_id : match.player2_id;
      const matchLoserId =
        matchWinnerId === match.player1_id
          ? match.player2_id
          : match.player1_id;
      const matchWinnerName =
        matchWinnerId === match.player1_id ? p1Name : p2Name;

      updateMatchResult(match.id, {
        winnerId: matchWinnerId,
        loserId: matchLoserId,
        player1Score: newP1Score,
        player2Score: newP2Score,
      });

      const updatedMatch = getMatchById(match.id);

      await updateMatchThreadEmbed(
        interaction.guild,
        tournament,
        updatedMatch,
        true,
        matchWinnerName,
      );

      await interaction.editReply({
        content:
          `✅ **Match Complete!**\n\n` +
          `🏆 **Winner:** ${matchWinnerName}\n` +
          `📊 **Final Score:** ${p1Name} ${newP1Score} — ${newP2Score} ${p2Name}\n\n` +
          `_Updating stats, posting results, and scheduling next matches…_`,
      });

      // ── Post-match processing ────────────────────────────────
      processMatchCompletion(interaction.guild, tournament, updatedMatch).catch(
        (err) => console.error("[SCORE] Post-match processing error:", err),
      );

      console.log(
        `[SCORE] Match #${match.match_number} (R${match.round}) completed: ${matchWinnerName} wins ${newP1Score}-${newP2Score}`,
      );
    } else {
      updateMatchScore(match.id, newP1Score, newP2Score);

      const updatedMatch = getMatchById(match.id);

      await updateMatchThreadEmbed(
        interaction.guild,
        tournament,
        updatedMatch,
        false,
      );

      const maxScore = Math.max(newP1Score, newP2Score);
      const gamesLeft = winsNeeded - maxScore;

      await interaction.editReply({
        content:
          `✅ **Game recorded!**\n\n` +
          `🎮 **Game winner:** ${gameWinnerName}\n` +
          `📊 **Current Score:** ${p1Name} ${newP1Score} — ${newP2Score} ${p2Name}\n` +
          `⏳ **${gamesLeft}** more win(s) needed to complete the match.`,
      });

      console.log(
        `[SCORE] Match #${match.match_number} (R${match.round}) score updated: ${p1Name} ${newP1Score} — ${newP2Score} ${p2Name}`,
      );
    }
  } catch (err) {
    console.error("[SCORE] Failed to record score:", err);
    await interaction.editReply({
      content: `❌ Failed to record score: ${err.message}`,
    });
  }
}
// ═════════════════════════════════════════════════════════════════
//  DISQUALIFY MODAL SUBMIT
// ═════════════════════════════════════════════════════════════════

async function handleDqSubmit(interaction, encodedId) {
  // encodedId format: "matchId:userId"
  const [matchIdStr, targetUserId] = encodedId.split(":");

  if (!targetUserId) {
    return interaction.reply({
      content: "❌ Invalid disqualification target.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const match = getMatchById(parseInt(matchIdStr, 10));
  if (!match) {
    return interaction.reply({
      content: "❌ Match not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournament = getTournamentById(match.tournament_id);
  if (!tournament) {
    return interaction.reply({
      content: "❌ Tournament not found.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason =
    interaction.fields.getTextInputValue("reason").trim() ||
    "No reason provided";

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { disqualifyPlayer } = await import("../services/disqualifyService.js");
  const result = await disqualifyPlayer(
    interaction.guild,
    tournament,
    targetUserId,
    reason,
  );

  await interaction.editReply({ content: result.message });
}
