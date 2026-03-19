import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getTournamentById, getParticipant, getActiveMatchByPlayer, getPendingMatchesByPlayer, getMatchesByPlayer } from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder().setName('match').setDescription('Show your current match')
  .addStringOption(o => o.setName('tournament').setDescription('Select tournament').setRequired(true).setAutocomplete(true));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tournament = await getTournamentById(interaction.options.getString('tournament', true));
  if (!tournament || tournament.guild_id !== interaction.guildId) return interaction.editReply({ content: '❌ Not found.' });

  const participant = await getParticipant(tournament.id, interaction.user.id);
  if (!participant || participant.role !== 'participant') return interaction.editReply({ content: '❌ Not a participant.' });

  const activeMatch = await getActiveMatchByPlayer(tournament.id, interaction.user.id);
  if (activeMatch) {
    const oppId = activeMatch.player1_id === interaction.user.id ? activeMatch.player2_id : activeMatch.player1_id;
    const oppData = await getParticipant(tournament.id, oppId);
    const oppName = oppData?.display_name || oppData?.username || 'Unknown';
    const isP1 = activeMatch.player1_id === interaction.user.id;
    const myScore = isP1 ? activeMatch.player1_score : activeMatch.player2_score;
    const opScore = isP1 ? activeMatch.player2_score : activeMatch.player1_score;
    const winsNeeded = Math.ceil(tournament.best_of / 2);

    const embed = new EmbedBuilder().setTitle(`⚔️ Active Match — ${tournament.name}`).setColor(COLORS.WARNING)
      .addFields(
        { name: '🔄 Round', value: `${activeMatch.round}`, inline: true },
        { name: '🏷️ Match #', value: `${activeMatch.match_number}`, inline: true },
        { name: '🆚 Opponent', value: `**${oppName}** (<@${oppId}>)`, inline: false },
        { name: '📊 Score', value: `You: **${myScore}** — Opponent: **${opScore}**\n(First to **${winsNeeded}**)`, inline: false },
      );
    if (activeMatch.thread_id) embed.addFields({ name: '📌 Thread', value: `**[Go to match](https://discord.com/channels/${interaction.guildId}/${activeMatch.thread_id})**` });

    const allM = await getMatchesByPlayer(tournament.id, interaction.user.id);
    embed.addFields({ name: '📈 Progress', value: `✅ ${allM.filter(m=>m.status==='completed').length} done · 🟡 ${allM.filter(m=>m.status==='in_progress').length} active · ⏳ ${allM.filter(m=>m.status==='pending').length} pending\n📊 ${participant.wins}W/${participant.losses}L/${participant.draws}D · ${participant.points} pts` });
    return interaction.editReply({ embeds: [embed] });
  }

  const pendingMatches = await getPendingMatchesByPlayer(tournament.id, interaction.user.id);
  if (pendingMatches.length > 0) {
    const next = pendingMatches[0];
    const oppId = next.player1_id === interaction.user.id ? next.player2_id : next.player1_id;
    const oppData = await getParticipant(tournament.id, oppId);
    const embed = new EmbedBuilder().setTitle(`⏳ Next Match — ${tournament.name}`).setColor(COLORS.NEUTRAL)
      .setDescription('Your next match hasn\'t started yet.')
      .addFields(
        { name: '🔄 Round', value: `${next.round}`, inline: true },
        { name: '🆚 Opponent', value: `**${oppData?.display_name||oppData?.username||'Unknown'}** (<@${oppId}>)`, inline: false },
      ).setFooter({ text: `${pendingMatches.length} match(es) remaining` });
    return interaction.editReply({ embeds: [embed] });
  }

  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`✅ All Done — ${tournament.name}`).setColor(COLORS.SUCCESS).setDescription(`No more matches.\n📊 ${participant.wins}W/${participant.losses}L · ${participant.points} pts`).setTimestamp()] });
}
