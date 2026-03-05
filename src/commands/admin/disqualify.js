// ─── src/commands/admin/disqualify.js ────────────────────────────
// /disqualify <user>  — Disqualify a participant from the tournament
// whose channels the command is run in.
// Full implementation in Stage 8.

import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { isOrganizer } from "../../utils/permissions.js";
import { findTournamentByContext } from "../../utils/helpers.js";

export const data = new SlashCommandBuilder()
  .setName("disqualify")
  .setDescription("Disqualify a participant from the current tournament")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("The user to disqualify")
      .setRequired(true),
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

  // ── Permission guard ──────────────────────────────────────
  if (!isOrganizer(interaction.member)) {
    return interaction.reply({
      content: "❌ Only organisers can disqualify participants.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Tournament context guard ──────────────────────────────
  const tournament = findTournamentByContext(
    interaction.channelId,
    interaction.channel?.parentId,
  );

  if (!tournament) {
    return interaction.reply({
      content: "❌ Run this command inside a tournament channel.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const targetUser = interaction.options.getUser("user", true);

  // Stage 8 will replace the line below with full disqualify logic
  await interaction.reply({
    content: `🚧 Disqualification of **${targetUser.tag}** from **${tournament.name}** — coming in Stage 8.`,
    flags: MessageFlags.Ephemeral,
  });
}
