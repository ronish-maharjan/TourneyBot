// ─── src/services/giveawayService.js ─────────────────────────────

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getGiveawayById,
  getGiveawayConfig,
  getGiveawayEntries,
  updateGiveawayEnd,
  updateGiveawayReviewMessage,
} from '../database/queries.js';
import { COLORS } from '../config.js';

const processingGiveaways = new Set();

export function acquireGiveawayLock(id) {
  if (processingGiveaways.has(id)) return false;
  processingGiveaways.add(id);
  return true;
}

export function releaseGiveawayLock(id) {
  processingGiveaways.delete(id);
}

export function buildReviewEmbed(giveaway, creatorName) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Giveaway Pending Approval')
    .setColor(COLORS.WARNING)
    .addFields(
      { name: '🎁 Prize',      value: giveaway.prize,             inline: true },
      { name: '👤 Created By', value: creatorName,                inline: true },
      { name: '🏆 Winners',    value: `${giveaway.winner_count}`, inline: true },
      { name: '⏱️ Duration',   value: formatDuration(giveaway.duration_minutes), inline: true },
      { name: '🆔 ID',         value: `${giveaway.id}`,           inline: true },
    )
    .setTimestamp();

  if (giveaway.description?.trim()) embed.addFields({ name: '📝 Description', value: giveaway.description.substring(0, 1024) });
  embed.setFooter({ text: 'Approve to publish or reject with a reason' });
  return embed;
}

export function buildReviewButtons(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ga_approve_${giveawayId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ga_reject_${giveawayId}`).setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
}

export function buildDisabledReviewButtons(giveawayId, decision) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ga_approve_${giveawayId}`).setLabel(decision === 'approved' ? 'Approved ✅' : 'Approve').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId(`ga_reject_${giveawayId}`).setLabel(decision === 'rejected' ? 'Rejected ❌' : 'Reject').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(true),
  );
}

export async function sendStaffReview(guild, giveaway) {
  const creator = await guild.members.fetch(giveaway.creator_id).catch(() => null);
  const creatorName = creator?.displayName || 'Unknown User';

  const embed   = buildReviewEmbed(giveaway, creatorName);
  const buttons = buildReviewButtons(giveaway.id);

  const config = await getGiveawayConfig(guild.id);
  if (!config) return;

  try {
    const staffRole = guild.roles.cache.get(config.staff_role_id);
    if (!staffRole) return;

    await guild.members.fetch();
    const members = staffRole.members;
    let sentCount = 0;

    for (const [, member] of members) {
      if (member.user.bot) continue;
      try {
        await member.send({ content: `📋 **New giveaway pending approval in ${guild.name}!**`, embeds: [embed], components: [buttons] });
        sentCount++;
      } catch {}
    }

    console.log(`[GIVEAWAY] Sent review DM to ${sentCount}/${members.size} staff`);
  } catch (err) {
    console.warn('[GIVEAWAY] Could not DM staff:', err.message);
  }
}

export function buildGiveawayEmbed(giveaway, entryCount = 0, ended = false) {
  const embed = new EmbedBuilder().setTimestamp();

  if (ended) {
    embed.setTitle('🎉 GIVEAWAY ENDED 🎉').setColor(COLORS.NEUTRAL);
  } else {
    embed.setTitle('🎉 GIVEAWAY 🎉').setColor(COLORS.SUCCESS);
  }

  embed.addFields({ name: '🎁 Prize', value: giveaway.prize, inline: false });
  if (giveaway.description?.trim()) embed.addFields({ name: '📝 Details', value: giveaway.description.substring(0, 1024), inline: false });
  embed.addFields(
    { name: '🏆 Winners', value: `${giveaway.winner_count}`, inline: true },
    { name: '🎫 Entries', value: `${entryCount}`,             inline: true },
  );

  if (!ended && giveaway.ends_at) {
    const epoch = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
    embed.addFields({ name: '⏰ Ends', value: `<t:${epoch}:R> (<t:${epoch}:F>)`, inline: false });
  }

  embed.addFields({ name: '🎗️ Hosted By', value: `<@${giveaway.creator_id}>`, inline: true });
  embed.setFooter({ text: `Giveaway ID: ${giveaway.id}${ended ? ' · Ended' : ' · Click to enter!'}` });
  return embed;
}

export function buildGiveawayButtons(giveawayId, ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ga_enter_${giveawayId}`)
      .setLabel(ended ? 'Giveaway Ended' : '🎉 Enter Giveaway')
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(ended),
  );
}

export async function endGiveaway(guild, giveaway) {
  await updateGiveawayEnd(giveaway.id);

  const entries = await getGiveawayEntries(giveaway.id);
  const winners = pickWinners(entries, giveaway.winner_count);
  const fresh   = await getGiveawayById(giveaway.id);

  if (fresh.channel_id && fresh.message_id) {
    try {
      const channel = await guild.channels.fetch(fresh.channel_id).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(fresh.message_id).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [buildGiveawayEmbed(fresh, entries.length, true)], components: [buildGiveawayButtons(fresh.id, true)] });
        }

        if (winners.length > 0) {
          const mentions = winners.map(id => `<@${id}>`).join(', ');
          await channel.send({
            content: `🎉 **Congratulations** ${mentions}!`,
            embeds: [new EmbedBuilder().setTitle('🏆 Giveaway Winners!').setColor(COLORS.SUCCESS)
              .setDescription(`**Prize:** ${fresh.prize}\n**Winner(s):** ${mentions}\n\n_Hosted by <@${fresh.creator_id}>_`)
              .setFooter({ text: `ID: ${fresh.id} · ${entries.length} entries` }).setTimestamp()],
          });
        } else {
          await channel.send({ embeds: [new EmbedBuilder().setTitle('😔 No Winners').setColor(COLORS.NEUTRAL).setDescription(`Nobody entered for **${fresh.prize}**.`).setTimestamp()] });
        }
      }
    } catch (err) { console.error('[GIVEAWAY] Could not update:', err.message); }
  }

  for (const winnerId of winners) {
    try {
      const member = await guild.members.fetch(winnerId).catch(() => null);
      if (member) await member.send({ embeds: [new EmbedBuilder().setTitle('🎉 You Won!').setColor(COLORS.SUCCESS).setDescription(`You won **${fresh.prize}** in **${guild.name}**!\nContact <@${fresh.creator_id}> to claim.`).setFooter({ text: guild.name }).setTimestamp()] });
    } catch {}
  }

  try {
    const creator = await guild.members.fetch(fresh.creator_id).catch(() => null);
    if (creator) {
      const winnerText = winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'No entries';
      await creator.send({ embeds: [new EmbedBuilder().setTitle('🎉 Your Giveaway Ended!').setColor(COLORS.INFO).setDescription(`**${fresh.prize}** ended!\n🏆 **Winner(s):** ${winnerText}\n🎫 **Entries:** ${entries.length}`).setFooter({ text: guild.name }).setTimestamp()] });
    }
  } catch {}

  console.log(`[GIVEAWAY] Ended #${fresh.id} — ${winners.length} winner(s) from ${entries.length} entries`);
  return winners;
}

export async function rerollGiveaway(guild, giveaway) {
  const entries = await getGiveawayEntries(giveaway.id);
  const winners = pickWinners(entries, giveaway.winner_count);

  if (giveaway.channel_id) {
    try {
      const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
      if (channel) {
        if (winners.length > 0) {
          const mentions = winners.map(id => `<@${id}>`).join(', ');
          await channel.send({ content: `🔄 **Rerolled!** ${mentions}`, embeds: [new EmbedBuilder().setTitle('🔄 Rerolled!').setColor(COLORS.SUCCESS).setDescription(`**Prize:** ${giveaway.prize}\n**New Winner(s):** ${mentions}`).setFooter({ text: `ID: ${giveaway.id}` }).setTimestamp()] });
        } else {
          await channel.send({ embeds: [new EmbedBuilder().setTitle('😔 Reroll Failed').setColor(COLORS.NEUTRAL).setDescription('No valid entries.').setTimestamp()] });
        }
      }
    } catch (err) { console.error('[GIVEAWAY] Reroll failed:', err.message); }
  }

  for (const winnerId of winners) {
    try {
      const member = await guild.members.fetch(winnerId).catch(() => null);
      if (member) await member.send({ embeds: [new EmbedBuilder().setTitle('🎉 You Won (Reroll)!').setColor(COLORS.SUCCESS).setDescription(`You won **${giveaway.prize}** in **${guild.name}**!\nContact <@${giveaway.creator_id}> to claim.`).setFooter({ text: guild.name }).setTimestamp()] });
    } catch {}
  }

  console.log(`[GIVEAWAY] Rerolled #${giveaway.id} — ${winners.length} winner(s)`);
  return winners;
}

function pickWinners(entries, count) {
  if (entries.length === 0) return [];
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, entries.length)).map(e => e.user_id);
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} minute(s)`;
  if (minutes < 1440) { const h = Math.floor(minutes / 60); const m = minutes % 60; return m > 0 ? `${h}h ${m}m` : `${h} hour(s)`; }
  const d = Math.floor(minutes / 1440); const h = Math.floor((minutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d} day(s)`;
}
