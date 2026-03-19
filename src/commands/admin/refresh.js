import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { findTournamentByContext } from '../../utils/helpers.js';
import { getTournamentById } from '../../database/queries.js';
import { COLORS } from '../../config.js';
import { refreshAdminPanel, refreshRegistrationMessage, refreshParticipationList, refreshLeaderboard, refreshBracket, refreshRules } from '../../services/tournamentService.js';

export const data = new SlashCommandBuilder()
  .setName('refresh')
  .setDescription('Force refresh all tournament displays (admin only)');

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Organisers only.', flags: MessageFlags.Ephemeral });

  const tournament = await findTournamentByContext(interaction.channelId, interaction.channel?.parentId);
  if (!tournament) return interaction.reply({ content: '❌ Run in a tournament channel.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fresh = await getTournamentById(tournament.id);
  const results = [];

  for (const [name, fn] of [
    ['Admin Panel', refreshAdminPanel], ['Registration', refreshRegistrationMessage],
    ['Participation', refreshParticipationList], ['Leaderboard', refreshLeaderboard],
    ['Bracket', refreshBracket], ['Rules', refreshRules],
  ]) {
    try { await fn(interaction.guild, fresh); results.push(`✅ ${name}`); }
    catch { results.push(`❌ ${name}`); }
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle('🔄 Tournament Refreshed').setColor(COLORS.SUCCESS)
      .setDescription(`All displays for **${fresh.name}** refreshed.\n\n${results.join('\n')}`)
      .setFooter({ text: 'Missing messages are automatically recreated' }).setTimestamp()],
  });
}
