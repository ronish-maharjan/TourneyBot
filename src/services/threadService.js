// ─── src/services/threadService.js ───────────────────────────────

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import {
  getParticipant,
  updateMatchThread,
  updateMatchStatus,
} from '../database/queries.js';
import { COLORS, MATCH_STATUS } from '../config.js';
import { safePin } from '../utils/helpers.js';

export async function createMatchThread(guild, tournament, match) {
  if (!tournament.match_channel_id) return null;

  try {
    const matchChannel = await guild.channels.fetch(tournament.match_channel_id);
    if (!matchChannel) return null;

    const p1Data = await getParticipant(tournament.id, match.player1_id);
    const p2Data = await getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    const short1 = p1Name.length > 20 ? p1Name.substring(0, 19) + '…' : p1Name;
    const short2 = p2Name.length > 20 ? p2Name.substring(0, 19) + '…' : p2Name;
    const threadName = `⚔️ R${match.round}·M${match.match_number} — ${short1} vs ${short2}`;

    const thread = await matchChannel.threads.create({
      name: threadName.substring(0, 100),
      type: ChannelType.PublicThread,
      reason: `Match: ${p1Name} vs ${p2Name}`,
    });

    const matchEmbed = buildMatchEmbed(tournament, match, p1Name, p2Name);
    const actionRow  = buildMatchButtons(match.id);

    const scoreMessage = await thread.send({
      content: `⚔️ <@${match.player1_id}> vs <@${match.player2_id}>`,
      embeds: [matchEmbed],
      components: [actionRow],
    });

    await safePin(scoreMessage);
    await updateMatchThread(match.id, thread.id, scoreMessage.id);
    await updateMatchStatus(match.id, MATCH_STATUS.IN_PROGRESS);

    await notifyPlayer(guild, match.player1_id, tournament, match, p2Name, thread);
    await notifyPlayer(guild, match.player2_id, tournament, match, p1Name, thread);

    console.log(`[THREAD] Created thread for Match #${match.match_number} (R${match.round})`);
    return thread;

  } catch (err) {
    console.error(`[THREAD] Failed to create thread for match ${match.id}:`, err.message);
    return null;
  }
}

export async function createMatchThreads(guild, tournament, matches) {
  let created = 0;
  for (const match of matches) {
    const thread = await createMatchThread(guild, tournament, match);
    if (thread) created++;
    if (matches.length > 3) await sleep(500);
  }
  console.log(`[THREAD] Created ${created}/${matches.length} match threads`);
  return created;
}

export function buildMatchEmbed(tournament, match, p1Name, p2Name) {
  const short1 = p1Name.length > 25 ? p1Name.substring(0, 24) + '…' : p1Name;
  const short2 = p2Name.length > 25 ? p2Name.substring(0, 24) + '…' : p2Name;

  return new EmbedBuilder()
    .setTitle(`⚔️ ${short1}  vs  ${short2}`)
    .setColor(COLORS.WARNING)
    .addFields(
      { name: 'Tournament', value: tournament.name,             inline: true },
      { name: 'Round',      value: `${match.round}`,            inline: true },
      { name: 'Match #',    value: `${match.match_number}`,     inline: true },
      { name: 'Best Of',    value: `${tournament.best_of}`,     inline: true },
      { name: 'Status',     value: '🟡 In Progress',             inline: true },
      { name: '📊 Score',   value: formatScore(p1Name, match.player1_score, p2Name, match.player2_score), inline: false },
    )
    .setFooter({ text: `Match ID: ${match.id} · Admin: use buttons below` })
    .setTimestamp();
}

export function buildCompletedMatchEmbed(tournament, match, p1Name, p2Name, winnerName) {
  const short1 = p1Name.length > 25 ? p1Name.substring(0, 24) + '…' : p1Name;
  const short2 = p2Name.length > 25 ? p2Name.substring(0, 24) + '…' : p2Name;
  const shortWinner = winnerName.length > 30 ? winnerName.substring(0, 29) + '…' : winnerName;

  return new EmbedBuilder()
    .setTitle(`✅ ${short1}  vs  ${short2}`)
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'Tournament', value: tournament.name,         inline: true },
      { name: 'Round',      value: `${match.round}`,        inline: true },
      { name: 'Match #',    value: `${match.match_number}`, inline: true },
      { name: 'Best Of',    value: `${tournament.best_of}`, inline: true },
      { name: 'Status',     value: '✅ Completed',           inline: true },
      { name: '🏆 Winner',  value: shortWinner,               inline: true },
      { name: '📊 Final Score', value: formatScore(p1Name, match.player1_score, p2Name, match.player2_score), inline: false },
    )
    .setFooter({ text: `Match ID: ${match.id}` })
    .setTimestamp();
}

export function buildMatchButtons(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match_score_${matchId}`).setLabel('Add Score').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`match_dq_${matchId}`).setLabel('Disqualify').setEmoji('⛔').setStyle(ButtonStyle.Danger),
  );
}

export function buildDisabledMatchButtons(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match_score_${matchId}`).setLabel('Add Score').setEmoji('📝').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`match_dq_${matchId}`).setLabel('Disqualify').setEmoji('⛔').setStyle(ButtonStyle.Danger).setDisabled(true),
  );
}

function formatScore(p1Name, p1Score, p2Name, p2Score) {
  const p1Bar = '🟦'.repeat(p1Score) || '⬛';
  const p2Bar = '🟥'.repeat(p2Score) || '⬛';
  return `**${p1Name}:** ${p1Score} ${p1Bar}\n**${p2Name}:** ${p2Score} ${p2Bar}`;
}

async function notifyPlayer(guild, userId, tournament, match, opponentName, thread) {
  try {
    const member = await guild.members.fetch(userId);
    if (!member) return;
    const threadUrl = `https://discord.com/channels/${guild.id}/${thread.id}`;

    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚔️ New Match!')
          .setColor(COLORS.WARNING)
          .setDescription(
            `You have a new match in **${tournament.name}**!\n\n` +
            `🆚 **Opponent:** ${opponentName}\n` +
            `🔄 **Round:** ${match.round}\n` +
            `🏷️ **Match #:** ${match.match_number}\n` +
            `🎯 **Best Of:** ${tournament.best_of}\n\n` +
            `📌 **[Click here to go to your match thread](${threadUrl})**`,
          )
          .setFooter({ text: guild.name })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.warn(`[DM] Could not notify ${userId}:`, err.message);
  }
}

export async function updateMatchThreadEmbed(guild, tournament, match, isCompleted = false, winnerName = null) {
  if (!match.thread_id || !match.score_message_id) return;

  try {
    const thread = await guild.channels.fetch(match.thread_id);
    if (!thread) return;

    const msg = await thread.messages.fetch(match.score_message_id);
    if (!msg) return;

    const p1Data = await getParticipant(tournament.id, match.player1_id);
    const p2Data = await getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    if (isCompleted) {
      const embed   = buildCompletedMatchEmbed(tournament, match, p1Name, p2Name, winnerName || 'Unknown');
      const buttons = buildDisabledMatchButtons(match.id);
      await msg.edit({ embeds: [embed], components: [buttons] });

      const completionMsg = await thread.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setDescription(
              `## 🏆 Match Complete!\n\n` +
              `**Winner:** ${winnerName}\n` +
              `**Score:** ${p1Name} **${match.player1_score}** — **${match.player2_score}** ${p2Name}\n\n` +
              `_This thread is now closed._`,
            )
            .setTimestamp(),
        ],
      });
      await safePin(completionMsg);

      const isDq = winnerName?.includes('DQ') || winnerName?.includes('dq') || winnerName?.includes("DQ'd");
      const prefix = isDq ? '⛔' : '✅';
      const shortWin = (winnerName || 'Unknown').length > 20
        ? (winnerName || 'Unknown').substring(0, 19) + '…'
        : (winnerName || 'Unknown');
      const newName = `${prefix} R${match.round}·M${match.match_number} — ${shortWin} wins`;

      try { await thread.setName(newName.substring(0, 100)); } catch {}
      try { await thread.setLocked(true, 'Match completed'); await thread.setArchived(true, 'Match completed'); } catch {}

    } else {
      const embed   = buildMatchEmbed(tournament, match, p1Name, p2Name);
      const buttons = buildMatchButtons(match.id);
      await msg.edit({ embeds: [embed], components: [buttons] });
    }
  } catch (err) {
    console.warn(`[THREAD] Could not update match thread for match ${match.id}:`, err.message);
  }
}

export async function markThreadCancelled(guild, match) {
  if (!match.thread_id) return;
  try {
    const thread = await guild.channels.fetch(match.thread_id);
    if (!thread) return;

    const newName = `❌ R${match.round}·M${match.match_number} — Cancelled`;
    try { await thread.setName(newName.substring(0, 100)); } catch {}

    const cancelMsg = await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setDescription('## ❌ Match Cancelled\n\n_This match has been cancelled due to a disqualification._')
          .setTimestamp(),
      ],
    });
    await safePin(cancelMsg);

    if (match.score_message_id) {
      try {
        const msg = await thread.messages.fetch(match.score_message_id);
        if (msg) await msg.edit({ components: [buildDisabledMatchButtons(match.id)] });
      } catch {}
    }

    try { await thread.setLocked(true, 'Match cancelled'); await thread.setArchived(true, 'Match cancelled'); } catch {}
  } catch (err) {
    console.warn(`[THREAD] Could not mark thread cancelled for match ${match.id}:`, err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
