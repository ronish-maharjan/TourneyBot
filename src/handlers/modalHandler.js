import { MessageFlags, EmbedBuilder } from 'discord.js';
import { getTournamentById, updateTournamentConfig, getMatchById, getParticipant, updateMatchScore, updateMatchResult, getGiveawayConfig, getGiveawayChannels, createGiveaway, getGiveawayById, updateGiveawayStatus } from '../database/queries.js';
import { refreshAdminPanel, refreshRegistrationMessage, refreshRules } from '../services/tournamentService.js';
import { updateMatchThreadEmbed } from '../services/threadService.js';
import { processMatchCompletion } from '../services/matchService.js';
import { sendStaffReview, formatDuration, buildDisabledReviewButtons } from '../services/giveawayService.js';
import { acquireLock, releaseLock } from '../services/lockService.js';
import { MAX_PLAYERS_LIMIT, VALID_BEST_OF, VALID_TEAM_SIZES, TOURNAMENT_STATUS, COLORS } from '../config.js';

export async function handleModal(interaction) {
  const [prefix, action, ...rest] = interaction.customId.split('_');
  const targetId = rest.join('_');
  if (prefix !== 'modal') return interaction.reply({ content: '❓ Unknown modal.', flags: MessageFlags.Ephemeral });

  switch (action) {
    case 'configure': return handleConfigureSubmit(interaction, targetId);
    case 'score':     return handleScoreSubmit(interaction, targetId);
    case 'dq':        return handleDqSubmit(interaction, targetId);
    case 'giveaway':  return handleGiveawayCreate(interaction, targetId);
    case 'gareject':  return handleGiveawayReject(interaction, targetId);
    default: return interaction.reply({ content: '❓ Unknown modal.', flags: MessageFlags.Ephemeral });
  }
}

async function handleConfigureSubmit(interaction, tournamentId) {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });
  if ([TOURNAMENT_STATUS.IN_PROGRESS, TOURNAMENT_STATUS.COMPLETED, TOURNAMENT_STATUS.CANCELLED].includes(tournament.status)) return interaction.reply({ content: '❌ Cannot configure after start.', flags: MessageFlags.Ephemeral });

  const name = interaction.fields.getTextInputValue('tournament_name').trim();
  const maxStr = interaction.fields.getTextInputValue('max_players').trim();
  const teamStr = interaction.fields.getTextInputValue('team_size').trim();
  const bestStr = interaction.fields.getTextInputValue('best_of').trim();
  const rules = interaction.fields.getTextInputValue('rules')?.trim() || '';

  const errors = [];
  if (name.length < 2 || name.length > 50) errors.push('• Name: 2–50 chars.');
  const maxPlayers = parseInt(maxStr); if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS_LIMIT) errors.push(`• Max Players: 2–${MAX_PLAYERS_LIMIT}.`);
  const teamSize = parseInt(teamStr); if (!VALID_TEAM_SIZES.includes(teamSize)) errors.push(`• Team Size: ${VALID_TEAM_SIZES.join(', ')}.`);
  const bestOf = parseInt(bestStr); if (!VALID_BEST_OF.includes(bestOf)) errors.push(`• Best Of: ${VALID_BEST_OF.join(', ')}.`);
  if (errors.length > 0) return interaction.reply({ content: `❌ **Errors:**\n${errors.join('\n')}`, flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateTournamentConfig(tournament.id, { name, maxPlayers, teamSize, bestOf, rules });
  const fresh = await getTournamentById(tournament.id);
  await refreshAdminPanel(interaction.guild, fresh);
  await refreshRules(interaction.guild, fresh);
  if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) await refreshRegistrationMessage(interaction.guild, fresh);
  await interaction.editReply({ content: `✅ Updated!\n📝 **${name}** · 👥 ${maxPlayers} · 👤 ${teamSize===1?'Solo':'Duo'} · 🎯 Bo${bestOf}\n📜 ${rules||'None'}` });
}

async function handleScoreSubmit(interaction, matchIdStr) {
  const matchId = parseInt(matchIdStr);
  if (!acquireLock(`match_${matchId}`)) return interaction.reply({ content: '⏳ Another staff is scoring.', flags: MessageFlags.Ephemeral });

  try {
    const match = await getMatchById(matchId);
    if (!match) return interaction.reply({ content: '❌ Not found.', flags: MessageFlags.Ephemeral });
    if (match.status === 'completed') return interaction.reply({ content: '❌ Already completed.', flags: MessageFlags.Ephemeral });
    if (match.status === 'cancelled') return interaction.reply({ content: '❌ Cancelled.', flags: MessageFlags.Ephemeral });

    const tournament = await getTournamentById(match.tournament_id);
    if (!tournament) return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });

    const winnerInput = interaction.fields.getTextInputValue('winner').trim();
    if (winnerInput !== '1' && winnerInput !== '2') return interaction.reply({ content: '❌ Enter **1** or **2**.', flags: MessageFlags.Ephemeral });

    const gameWinnerId = winnerInput === '1' ? match.player1_id : match.player2_id;
    let newP1 = match.player1_score, newP2 = match.player2_score;
    if (gameWinnerId === match.player1_id) newP1++; else newP2++;

    const p1Data = await getParticipant(tournament.id, match.player1_id);
    const p2Data = await getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'P1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'P2';
    const gameWinnerName = gameWinnerId === match.player1_id ? p1Name : p2Name;

    const winsNeeded = Math.ceil(tournament.best_of / 2);
    const isCompleted = newP1 >= winsNeeded || newP2 >= winsNeeded;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (isCompleted) {
      const winnerId = newP1 >= winsNeeded ? match.player1_id : match.player2_id;
      const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
      const winnerName = winnerId === match.player1_id ? p1Name : p2Name;

      await updateMatchResult(match.id, { winnerId, loserId, player1Score: newP1, player2Score: newP2 });
      const updated = await getMatchById(match.id);
      await updateMatchThreadEmbed(interaction.guild, tournament, updated, true, winnerName);
      await interaction.editReply({ content: `✅ **Match Complete!**\n🏆 **${winnerName}**\n📊 ${p1Name} ${newP1} — ${newP2} ${p2Name}` });
      processMatchCompletion(interaction.guild, tournament, updated).catch(err => console.error('[SCORE]', err));
    } else {
      await updateMatchScore(match.id, newP1, newP2);
      const updated = await getMatchById(match.id);
      await updateMatchThreadEmbed(interaction.guild, tournament, updated, false);
      await interaction.editReply({ content: `✅ **Game recorded!**\n🎮 ${gameWinnerName}\n📊 ${p1Name} ${newP1} — ${newP2} ${p2Name}\n⏳ ${winsNeeded - Math.max(newP1,newP2)} more win(s) needed.` });
    }
  } catch (err) {
    console.error('[SCORE]', err);
    try { if (interaction.deferred) await interaction.editReply({ content: `❌ ${err.message}` }); else await interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral }); } catch {}
  } finally { releaseLock(`match_${matchId}`); }
}

async function handleDqSubmit(interaction, encodedId) {
  const [matchIdStr, targetUserId] = encodedId.split(':');
  if (!targetUserId) return interaction.reply({ content: '❌ Invalid target.', flags: MessageFlags.Ephemeral });
  if (!acquireLock(`dq_${targetUserId}`)) return interaction.reply({ content: '⏳ Already processing.', flags: MessageFlags.Ephemeral });

  try {
    const match = await getMatchById(parseInt(matchIdStr));
    if (!match) return interaction.reply({ content: '❌ Match not found.', flags: MessageFlags.Ephemeral });
    const tournament = await getTournamentById(match.tournament_id);
    if (!tournament) return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { disqualifyPlayer } = await import('../services/disqualifyService.js');
    const result = await disqualifyPlayer(interaction.guild, tournament, targetUserId, reason);
    await interaction.editReply({ content: result.message });
  } catch (err) {
    console.error('[DQ]', err);
    try { if (interaction.deferred) await interaction.editReply({ content: `❌ ${err.message}` }); else await interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral }); } catch {}
  } finally { releaseLock(`dq_${targetUserId}`); }
}

async function handleGiveawayCreate(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await getGiveawayConfig(interaction.guildId);
  const channels = await getGiveawayChannels(interaction.guildId);
  if (!config || channels.length === 0) return interaction.editReply({ content: '❌ Giveaway not configured.' });

  const prize = interaction.fields.getTextInputValue('prize').trim();
  const description = interaction.fields.getTextInputValue('description')?.trim() || '';
  const durationStr = interaction.fields.getTextInputValue('duration').trim();
  const winnersStr = interaction.fields.getTextInputValue('winners').trim();

  const errors = [];
  if (prize.length < 2 || prize.length > 100) errors.push('• Prize: 2–100 chars.');
  const duration = parseInt(durationStr); if (isNaN(duration) || duration < 1 || duration > 10080) errors.push('• Duration: 1–10080 min.');
  const winnerCount = parseInt(winnersStr); if (isNaN(winnerCount) || winnerCount < 1 || winnerCount > 10) errors.push('• Winners: 1–10.');
  if (errors.length > 0) return interaction.editReply({ content: `❌ **Errors:**\n${errors.join('\n')}` });

  try {
    const result = await createGiveaway({ guildId: interaction.guildId, creatorId: interaction.user.id, prize, description, winnerCount, durationMinutes: duration });
    const giveaway = await getGiveawayById(Number(result.lastInsertRowid));
    if (!giveaway) return interaction.editReply({ content: '❌ Failed to create.' });

    await sendStaffReview(interaction.guild, giveaway);
    await interaction.editReply({ content: `✅ **Submitted for approval!**\n🎁 **${prize}** · 🏆 ${winnerCount} winner(s) · ⏱️ ${formatDuration(duration)}\n**ID:** #${giveaway.id}` });
  } catch (err) {
    console.error('[GIVEAWAY]', err);
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  }
}

async function handleGiveawayReject(interaction, giveawayIdStr) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const giveawayId = parseInt(giveawayIdStr);
  const giveaway = await getGiveawayById(giveawayId);
  if (!giveaway || giveaway.status !== 'pending') return interaction.editReply({ content: '❌ Not found or already processed.' });

  const { acquireGiveawayLock, releaseGiveawayLock } = await import('../services/giveawayService.js');
  if (!acquireGiveawayLock(giveawayId)) return interaction.editReply({ content: '⏳ Already being processed.' });

  try {
    const fresh = await getGiveawayById(giveawayId);
    if (fresh.status !== 'pending') return interaction.editReply({ content: `⚠️ Already **${fresh.status}**.` });
    const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason';
    await updateGiveawayStatus(giveaway.id, 'cancelled');

    const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
    if (guild) {
      try {
        const creator = await guild.members.fetch(giveaway.creator_id).catch(() => null);
        if (creator) await creator.send({ embeds: [new EmbedBuilder().setTitle('❌ Giveaway Rejected').setColor(COLORS.DANGER).setDescription(`**${giveaway.prize}** in **${guild.name}** rejected.\n📝 **Reason:** ${reason}\n❌ **By:** ${interaction.user.displayName}`).setFooter({ text: guild.name }).setTimestamp()] });
      } catch {}
    }

    await interaction.editReply({ content: `✅ Giveaway **#${giveaway.id}** rejected.\n📝 **Reason:** ${reason}` });
  } catch (err) {
    console.error('[GIVEAWAY]', err);
    await interaction.editReply({ content: `❌ Failed: ${err.message}` });
  } finally { releaseGiveawayLock(giveawayId); }
}
