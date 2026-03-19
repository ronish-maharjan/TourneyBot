import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getActiveTournamentsByGuild, getParticipantCount, getActiveParticipantCount, getCompletedMatchCount, getTotalMatchCount } from '../../database/queries.js';
import { COLORS } from '../../config.js';
import { formatStatus } from '../../utils/helpers.js';

export const data = new SlashCommandBuilder().setName('tournaments').setDescription('List active tournaments');

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tournaments = await getActiveTournamentsByGuild(interaction.guildId);
  if (tournaments.length === 0) return interaction.editReply({ content: '📭 No active tournaments.' });

  const lines = [];
  for (let i = 0; i < tournaments.length; i++) {
    const t = tournaments[i];
    const active = await getActiveParticipantCount(t.id);
    const completedM = await getCompletedMatchCount(t.id);
    const totalM = await getTotalMatchCount(t.id);
    const pct = totalM > 0 ? Math.round((completedM / totalM) * 100) : 0;
    let matchLine = totalM > 0 ? `\n　⚔️ Matches: ${completedM}/${totalM} (${pct}%) · Round ${t.current_round}/${t.total_rounds}` : '';
    lines.push(`**${i+1}. ${t.name}**\n　${formatStatus(t.status)}\n　👥 ${active}/${t.max_players} · ${t.team_size===1?'Solo':'Duo'} · Bo${t.best_of}${matchLine}`);
  }

  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏆 Active Tournaments').setColor(COLORS.PRIMARY).setDescription(lines.join('\n\n')).setFooter({ text: `${tournaments.length} tournament(s)` }).setTimestamp()] });
}
