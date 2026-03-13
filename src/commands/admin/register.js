// ─── src/commands/admin/register.js ──────────────────────────────
// /register <user>  — Admin registers a player into the tournament
// whose channels the command is run in.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { findTournamentByContext } from '../../utils/helpers.js';
import { adminRegisterParticipant } from '../../services/registrationService.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Register a player into the current tournament (admin only)')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('The user to register')
      .setRequired(true),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Permission guard ──────────────────────────────────────
  if (!isOrganizer(interaction.member)) {
    return interaction.reply({
      content: '❌ Only organisers can register players directly.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Tournament context ────────────────────────────────────
  const tournament = findTournamentByContext(
    interaction.channelId,
    interaction.channel?.parentId,
  );

  if (!tournament) {
    return interaction.reply({
      content: '❌ Run this command inside a tournament channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const targetUser = interaction.options.getUser('user', true);

  // ── Prevent registering bots ──────────────────────────────
  if (targetUser.bot) {
    return interaction.reply({
      content: '❌ You cannot register a bot as a participant.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Fetch member ──────────────────────────────────────────
  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return interaction.reply({
      content: '❌ Could not find that user in this server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await adminRegisterParticipant(
    interaction.guild,
    tournament,
    targetUser,
    member,
  );

  await interaction.editReply({ content: result.message });
}
