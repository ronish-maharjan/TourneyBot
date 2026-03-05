// ─── src/handlers/modalHandler.js ────────────────────────────────
// Routes modal-submit interactions by custom-ID prefix.

import { MessageFlags } from "discord.js";
import {
  getTournamentById,
  updateTournamentConfig,
} from "../database/queries.js";
import {
  refreshAdminPanel,
  refreshRegistrationMessage,
} from "../services/tournamentService.js";
import {
  MAX_PLAYERS_LIMIT,
  VALID_BEST_OF,
  VALID_TEAM_SIZES,
  TOURNAMENT_STATUS,
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
      // Stage 6: handle score entry
      await interaction.reply({
        content: "🚧 Score submit — Stage 6",
        flags: MessageFlags.Ephemeral,
      });
      break;
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

  // Cannot configure after start
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

  // ── Extract values ─────────────────────────────────────────
  const name = interaction.fields.getTextInputValue("tournament_name").trim();
  const maxStr = interaction.fields.getTextInputValue("max_players").trim();
  const teamStr = interaction.fields.getTextInputValue("team_size").trim();
  const bestStr = interaction.fields.getTextInputValue("best_of").trim();
  const rules = interaction.fields.getTextInputValue("rules")?.trim() || "";

  // ── Validate ───────────────────────────────────────────────
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

  // ── Save ───────────────────────────────────────────────────
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    updateTournamentConfig(tournament.id, {
      name,
      maxPlayers,
      teamSize,
      bestOf,
      rules,
    });

    // Refresh embeds
    const fresh = getTournamentById(tournament.id);
    await refreshAdminPanel(interaction.guild, fresh);

    // If registration is open, update that embed too
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
