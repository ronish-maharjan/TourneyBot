import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getTournamentById, getParticipantCount, getActiveParticipantCount, getCompletedMatchCount, getTotalMatchCount, getLeaderboard, getParticipant } from '../../database/queries.js';
import { COLORS } from '../../config.js';
import { formatStatus, discordTimestamp } from '../../utils/helpers.js';

export const data = new SlashCommandBuilder().setName('tournament-info').setDescription('Show tournament details')
  .addStringOption(o => o.setName('tournament').setDescription('Select tournament').setRequired(true).setAutocomplete(true));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tournament = await getTournamentById(interaction.options.getString('tournament', true));
  if (!tournament || tournament.guild_id !== interaction.guildId) return interaction.editReply({ content: '❌ Not found.' });

  const pCount = await getParticipantCount(tournament.id);
  const aCount = await getActiveParticipantCount(tournament.id);
  const cMatch = await getCompletedMatchCount(tournament.id);
  const tMatch = await getTotalMatchCount(tournament.id);
  const pct = tMatch > 0 ? Math.round((cMatch/tMatch)*100) : 0;

  const embed = new EmbedBuilder().setTitle(`🏆 ${tournament.name}`).setColor(COLORS.INFO)
    .addFields(
      { name: '📊 Status', value: formatStatus(tournament.status), inline: true },
      { name: '🔄 Format', value: 'Round Robin', inline: true },
      { name: '🎯 Best Of', value: `${tournament.best_of}`, inline: true },
      { name: '👤 Team Size', value: tournament.team_size===1?'Solo':'Duo', inline: true },
      { name: '👥 Players', value: `${aCount} active / ${pCount} registered / ${tournament.max_players} max`, inline: false },
    );

  if (tMatch > 0) embed.addFields({ name: '⚔️ Progress', value: `${'▓'.repeat(Math.round(pct/10))}${'░'.repeat(10-Math.round(pct/10))} ${pct}%\n${cMatch}/${tMatch} matches`, inline: false },
    { name: '🔄 Round', value: `${tournament.current_round}/${tournament.total_rounds}`, inline: true });

  if (['in_progress','completed'].includes(tournament.status)) {
    const lb = await getLeaderboard(tournament.id);
    if (lb.length > 0) {
      const medals = ['🥇','🥈','🥉'];
      embed.addFields({ name: '🏅 Top 3', value: lb.slice(0,3).map((p,i) => `${medals[i]} <@${p.user_id}> — **${p.points}** pts (${p.wins}W/${p.losses}L)`).join('\n') });
    }
  }

  const userP = await getParticipant(tournament.id, interaction.user.id);
  if (userP?.role === 'participant') {
    const lb = await getLeaderboard(tournament.id);
    const rank = lb.findIndex(l => l.user_id === interaction.user.id) + 1;
    embed.addFields({ name: '📋 Your Standing', value: `🏅 #${rank||'—'}\n⭐ ${userP.points} pts\n✅ ${userP.wins}W · ❌ ${userP.losses}L · 🤝 ${userP.draws}D` });
  }

  if (tournament.rules?.trim()) embed.addFields({ name: '📜 Rules', value: tournament.rules.substring(0,1024) });
  embed.setFooter({ text: `ID: ${tournament.id}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
