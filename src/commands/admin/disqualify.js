import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { findTournamentByContext } from '../../utils/helpers.js';
import { disqualifyPlayer } from '../../services/disqualifyService.js';

export const data = new SlashCommandBuilder()
  .setName('disqualify')
  .setDescription('Disqualify a participant from the current tournament')
  .addUserOption(opt => opt.setName('user').setDescription('The user to disqualify').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for disqualification').setRequired(false).setMaxLength(200));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const tournament = await findTournamentByContext(interaction.channelId, interaction.channel?.parentId);
  if (!tournament) return interaction.reply({ content: '❌ Run in a tournament channel.', flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser('user', true);
  const reason     = interaction.options.getString('reason') || 'Disqualified by admin';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await disqualifyPlayer(interaction.guild, tournament, targetUser.id, reason);
  await interaction.editReply({ content: result.message });
}
