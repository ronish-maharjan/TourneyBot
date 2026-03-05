// ─── src/handlers/buttonHandler.js ───────────────────────────────
// Routes button interactions by custom-ID prefix and executes logic.

import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { isOrganizer } from "../utils/permissions.js";
import {
  getTournamentById,
  getActiveParticipantCount,
} from "../database/queries.js";
import {
  COLORS,
  TOURNAMENT_STATUS,
  MAX_PLAYERS_LIMIT,
  VALID_BEST_OF,
  VALID_TEAM_SIZES,
} from "../config.js";
import {
  openRegistration,
  closeRegistration,
  startTournament,
  endTournament,
  deleteTournamentInfrastructure,
  refreshAdminPanel,
} from "../services/tournamentService.js";

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleButton(interaction) {
  const [category, action, ...rest] = interaction.customId.split("_");
  const targetId = rest.join("_");

  switch (category) {
    case "admin":
      return handleAdminButton(interaction, action, targetId);
    case "reg":
      return handleRegButton(interaction, action, targetId);
    case "match":
      return handleMatchButton(interaction, action, targetId);
    case "confirm":
      return handleConfirmButton(interaction, action, targetId);
    default:
      console.warn(
        `[BTN] Unknown category: ${category} (${interaction.customId})`,
      );
      await interaction.reply({
        content: "❓ Unknown action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleAdminButton(interaction, action, tournamentId) {
  // ── Permission check ───────────────────────────────────────
  if (!isOrganizer(interaction.member)) {
    return interaction.reply({
      content: "❌ Only organisers can use admin controls.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Fetch tournament ───────────────────────────────────────
  const tournament = getTournamentById(tournamentId);
  if (!tournament) {
    return interaction.reply({
      content: "❌ Tournament not found. It may have been deleted.",
      flags: MessageFlags.Ephemeral,
    });
  }

  switch (action) {
    case "configure":
      return showConfigureModal(interaction, tournament);
    case "openreg":
      return handleOpenReg(interaction, tournament);
    case "closereg":
      return handleCloseReg(interaction, tournament);
    case "start":
      return showStartConfirmation(interaction, tournament);
    case "end":
      return showEndConfirmation(interaction, tournament);
    case "delete":
      return showDeleteConfirmation(interaction, tournament);
    default:
      await interaction.reply({
        content: "❓ Unknown admin action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ── Configure: show modal ────────────────────────────────────────

async function showConfigureModal(interaction, tournament) {
  const status = tournament.status;
  if (
    [
      TOURNAMENT_STATUS.IN_PROGRESS,
      TOURNAMENT_STATUS.COMPLETED,
      TOURNAMENT_STATUS.CANCELLED,
    ].includes(status)
  ) {
    return interaction.reply({
      content:
        "❌ Cannot configure a tournament that has already started or ended.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_configure_${tournament.id}`)
    .setTitle("Configure Tournament");

  const nameInput = new TextInputBuilder()
    .setCustomId("tournament_name")
    .setLabel("Tournament Name")
    .setStyle(TextInputStyle.Short)
    .setValue(tournament.name)
    .setMinLength(2)
    .setMaxLength(50)
    .setRequired(true);

  const maxPlayersInput = new TextInputBuilder()
    .setCustomId("max_players")
    .setLabel("Max Players (2–100)")
    .setStyle(TextInputStyle.Short)
    .setValue(`${tournament.max_players}`)
    .setMinLength(1)
    .setMaxLength(3)
    .setRequired(true);

  const teamSizeInput = new TextInputBuilder()
    .setCustomId("team_size")
    .setLabel("Team Size (1 = Solo, 2 = Duo)")
    .setStyle(TextInputStyle.Short)
    .setValue(`${tournament.team_size}`)
    .setMinLength(1)
    .setMaxLength(1)
    .setRequired(true);

  const bestOfInput = new TextInputBuilder()
    .setCustomId("best_of")
    .setLabel(`Best Of (${VALID_BEST_OF.join(" or ")})`)
    .setStyle(TextInputStyle.Short)
    .setValue(`${tournament.best_of}`)
    .setMinLength(1)
    .setMaxLength(1)
    .setRequired(true);

  const rulesInput = new TextInputBuilder()
    .setCustomId("rules")
    .setLabel("Rules (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(tournament.rules || "")
    .setMaxLength(1000)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(maxPlayersInput),
    new ActionRowBuilder().addComponents(teamSizeInput),
    new ActionRowBuilder().addComponents(bestOfInput),
    new ActionRowBuilder().addComponents(rulesInput),
  );

  await interaction.showModal(modal);
}

// ── Open Registration ────────────────────────────────────────────

async function handleOpenReg(interaction, tournament) {
  if (
    ![
      TOURNAMENT_STATUS.CREATED,
      TOURNAMENT_STATUS.REGISTRATION_CLOSED,
    ].includes(tournament.status)
  ) {
    return interaction.reply({
      content:
        "❌ Registration can only be opened when the tournament is in **Created** or **Registration Closed** state.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await openRegistration(interaction.guild, tournament);
    await interaction.editReply({
      content:
        "✅ Registration is now **open**! Players can register in the registration channel.",
    });
  } catch (err) {
    console.error("[OPENREG]", err);
    await interaction.editReply({
      content: `❌ Failed to open registration: ${err.message}`,
    });
  }
}

// ── Close Registration ───────────────────────────────────────────

async function handleCloseReg(interaction, tournament) {
  if (tournament.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    return interaction.reply({
      content: "❌ Registration is not currently open.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await closeRegistration(interaction.guild, tournament);
    await interaction.editReply({
      content: "✅ Registration is now **closed**.",
    });
  } catch (err) {
    console.error("[CLOSEREG]", err);
    await interaction.editReply({
      content: `❌ Failed to close registration: ${err.message}`,
    });
  }
}

// ── Start Confirmation ───────────────────────────────────────────

async function showStartConfirmation(interaction, tournament) {
  if (tournament.status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED) {
    return interaction.reply({
      content: "❌ Close registration before starting the tournament.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const playerCount = getActiveParticipantCount(tournament.id);
  if (playerCount < 2) {
    return interaction.reply({
      content: `❌ At least **2** participants are needed. Currently: **${playerCount}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const totalMatches = (playerCount * (playerCount - 1)) / 2;

  const embed = new EmbedBuilder()
    .setTitle("⚠️ Start Tournament?")
    .setColor(COLORS.WARNING)
    .setDescription(
      `Are you sure you want to start **${tournament.name}**?\n\n` +
        `👥 **${playerCount}** participants\n` +
        `⚔️ **${totalMatches}** matches will be generated\n` +
        `📋 Format: Round Robin · Best of ${tournament.best_of}\n\n` +
        `This action cannot be undone.`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_start_${tournament.id}`)
      .setLabel("Start Tournament")
      .setEmoji("🚀")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`confirm_no_${tournament.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ── End Confirmation ─────────────────────────────────────────────

async function showEndConfirmation(interaction, tournament) {
  if (tournament.status !== TOURNAMENT_STATUS.IN_PROGRESS) {
    return interaction.reply({
      content: "❌ The tournament is not currently in progress.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("⚠️ End Tournament?")
    .setColor(COLORS.WARNING)
    .setDescription(
      `Are you sure you want to end **${tournament.name}**?\n\n` +
        `All remaining matches will be **cancelled**.\n` +
        `Final standings will be based on completed matches.`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_end_${tournament.id}`)
      .setLabel("End Tournament")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`confirm_no_${tournament.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Delete Confirmation ──────────────────────────────────────────

async function showDeleteConfirmation(interaction, tournament) {
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Delete Tournament?")
    .setColor(COLORS.DANGER)
    .setDescription(
      `This will **permanently delete** all channels, roles, and data for **${tournament.name}**.\n\n` +
        `⚠️ **This action cannot be undone!**`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_delete_${tournament.id}`)
      .setLabel("Delete Permanently")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`confirm_no_${tournament.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ═════════════════════════════════════════════════════════════════
//  CONFIRMATION BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleConfirmButton(interaction, action, tournamentId) {
  // ── Cancel any confirmation ────────────────────────────────
  if (action === "no") {
    return interaction.update({
      content: "❌ Action cancelled.",
      embeds: [],
      components: [],
    });
  }

  // ── Fetch tournament ───────────────────────────────────────
  const tournament = getTournamentById(tournamentId);
  if (!tournament) {
    return interaction.update({
      content: "❌ Tournament not found. It may have been deleted.",
      embeds: [],
      components: [],
    });
  }

  switch (action) {
    case "start":
      return executeStart(interaction, tournament);
    case "end":
      return executeEnd(interaction, tournament);
    case "delete":
      return executeDelete(interaction, tournament);
    default:
      await interaction.update({
        content: "❓ Unknown confirmation action.",
        embeds: [],
        components: [],
      });
  }
}

// ── Execute Start ────────────────────────────────────────────────

async function executeStart(interaction, tournament) {
  // Show processing state
  await interaction.update({
    content: "⏳ Generating matches and starting tournament…",
    embeds: [],
    components: [],
  });

  try {
    await startTournament(interaction.guild, tournament);

    await interaction.editReply({
      content:
        "✅ Tournament has **started**! Match threads will be created in the matches channel.",
    });
  } catch (err) {
    console.error("[START]", err);
    await interaction.editReply({
      content: `❌ Failed to start tournament: ${err.message}`,
    });
  }
}

// ── Execute End ──────────────────────────────────────────────────

async function executeEnd(interaction, tournament) {
  await interaction.update({
    content: "⏳ Ending tournament and calculating results…",
    embeds: [],
    components: [],
  });

  try {
    await endTournament(interaction.guild, tournament);

    await interaction.editReply({
      content:
        "✅ Tournament has **ended**! Final results have been posted in the notice channel.",
    });
  } catch (err) {
    console.error("[END]", err);
    await interaction.editReply({
      content: `❌ Failed to end tournament: ${err.message}`,
    });
  }
}

// ── Execute Delete ───────────────────────────────────────────────

async function executeDelete(interaction, tournament) {
  // Update the ephemeral message first — channel will be deleted
  await interaction.update({
    content: "⏳ Deleting tournament…",
    embeds: [],
    components: [],
  });

  try {
    await deleteTournamentInfrastructure(interaction.guild, tournament);

    // Try to edit reply — may fail if channel is already gone
    try {
      await interaction.editReply({
        content: "✅ Tournament has been **deleted**.",
      });
    } catch {
      // Channel was deleted, ephemeral message is gone — that's fine
    }
  } catch (err) {
    console.error("[DELETE]", err);
    try {
      await interaction.editReply({
        content: `❌ Failed to delete tournament: ${err.message}`,
      });
    } catch {
      // Channel gone — can't respond
    }
  }
}

// ═════════════════════════════════════════════════════════════════
//  REGISTRATION BUTTONS  (Stage 5 stubs)
// ═════════════════════════════════════════════════════════════════

async function handleRegButton(interaction, action, tournamentId) {
  switch (action) {
    case "register":
      await interaction.reply({
        content: "🚧 Register — Stage 5",
        flags: MessageFlags.Ephemeral,
      });
      break;
    case "unregister":
      await interaction.reply({
        content: "🚧 Unregister — Stage 5",
        flags: MessageFlags.Ephemeral,
      });
      break;
    case "spectate":
      await interaction.reply({
        content: "🚧 Spectate — Stage 5",
        flags: MessageFlags.Ephemeral,
      });
      break;
    default:
      await interaction.reply({
        content: "❓ Unknown registration action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ═════════════════════════════════════════════════════════════════
//  MATCH BUTTONS  (Stage 6 stubs)
// ═════════════════════════════════════════════════════════════════

async function handleMatchButton(interaction, action, matchId) {
  switch (action) {
    case "score":
      await interaction.reply({
        content: "🚧 Add Score — Stage 6",
        flags: MessageFlags.Ephemeral,
      });
      break;
    case "dq":
      await interaction.reply({
        content: "🚧 Disqualify from match — Stage 6",
        flags: MessageFlags.Ephemeral,
      });
      break;
    default:
      await interaction.reply({
        content: "❓ Unknown match action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}
