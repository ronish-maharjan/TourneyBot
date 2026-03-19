import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { findTournamentByContext } from '../../utils/helpers.js';
import { adminRegisterParticipant } from '../../services/registrationService.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Register a player into the current tournament (admin only)')
  .addUserOption(opt => opt.setName('user').setDescription('The user to register').setRequired(true));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const tournament = await findTournamentByContext(interaction.channelId, interaction.channel?.parentId);
  if (!tournament) return interaction.reply({ content: '❌ Run in a tournament channel.', flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser('user', true);
  if (targetUser.bot) return interaction.reply({ content: '❌ Cannot register a bot.', flags: MessageFlags.Ephemeral });

  let member;
  try { member = await interaction.guild.members.fetch(targetUser.id); }
  catch { return interaction.reply({ content: '❌ User not found in server.', flags: MessageFlags.Ephemeral }); }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await adminRegisterParticipant(interaction.guild, tournament, targetUser, member);
  await interaction.editReply({ content: result.message });
}
