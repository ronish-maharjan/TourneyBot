// ─── src/commands/admin/create.js ────────────────────────────────
// /create <name>  — Creates a new tournament with full infrastructure.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { isOrganizer } from "../../utils/permissions.js";
import { COLORS } from "../../config.js";
import { getActiveTournamentsByGuild } from "../../database/queries.js";
import { createTournamentInfrastructure } from "../../services/tournamentService.js";

export const data = new SlashCommandBuilder()
  .setName("create")
  .setDescription("Create a new tournament in this server")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("Name for the tournament")
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(50),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  // ── Guild-only guard ──────────────────────────────────────
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Permission guard (user) ───────────────────────────────
  if (!isOrganizer(interaction.member)) {
    return interaction.reply({
      content:
        "❌ Only the server owner or users with the **TournamentOrganizer** role can create tournaments.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Permission guard (bot) ────────────────────────────────
  const botMember = interaction.guild.members.me;
  const requiredBotPerms = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageMessages,
  ];

  if (!botMember.permissions.has(requiredBotPerms)) {
    return interaction.reply({
      content:
        "❌ I need **Manage Channels**, **Manage Roles**, and **Manage Messages** permissions.\n" +
        "Please update my role and try again.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournamentName = interaction.options.getString("name", true).trim();

  // ── Duplicate name check ──────────────────────────────────
  const existing = getActiveTournamentsByGuild(interaction.guildId);
  if (
    existing.some((t) => t.name.toLowerCase() === tournamentName.toLowerCase())
  ) {
    return interaction.reply({
      content: `❌ An active tournament named **${tournamentName}** already exists in this server.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Defer — creation takes several seconds ────────────────
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const tournament = await createTournamentInfrastructure(
      interaction.guild,
      interaction.client.user,
      tournamentName,
      interaction.user.id,
    );

    // ── Success embed ─────────────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle("✅ Tournament Created!")
      .setColor(COLORS.SUCCESS)
      .setDescription(`**${tournament.name}** is ready to configure.`)
      .addFields(
        {
          name: "📂 Category",
          value: `🏆 ${tournament.name}`,
          inline: true,
        },
        {
          name: "📋 Channels",
          value: "10 channels created",
          inline: true,
        },
        {
          name: "🎭 Roles",
          value: `${tournament.name} Participant\n${tournament.name} Spectator`,
          inline: true,
        },
        {
          name: "🛡️ Admin Panel",
          value: `<#${tournament.admin_channel_id}>`,
          inline: true,
        },
        {
          name: "🆔 Tournament ID",
          value: `\`${tournament.id}\``,
          inline: true,
        },
      )
      .setFooter({
        text: "Head to the admin panel to configure and open registration",
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[CREATE]", error);

    await interaction.editReply({
      content:
        "❌ Failed to create the tournament. Please check my permissions and try again.\n" +
        `Error: \`${error.message}\``,
    });
  }
}
