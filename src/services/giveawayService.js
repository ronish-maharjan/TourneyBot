// ─── src/services/giveawayService.js ─────────────────────────────
// Core giveaway service: review embeds, approval, ending, reroll.

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  getGiveawayById,
  getGiveawayConfig,
  getGiveawayChannels,
  getGiveawayEntries,
  getGiveawayEntryCount,
  updateGiveawayApproval,
  updateGiveawayEnd,
  updateGiveawayStatus,
  updateGiveawayReviewMessage,
  updateGiveawayMessage,
  deleteGiveawayEntries,
} from '../database/queries.js';
import { COLORS } from '../config.js';

// ── Simple in-memory lock to prevent concurrent processing ──────
const processingGiveaways = new Set();

/**
 * Try to acquire a lock for a giveaway.
 * @param {number} giveawayId
 * @returns {boolean} true if lock acquired, false if already locked
 */
export function acquireGiveawayLock(giveawayId) {
  if (processingGiveaways.has(giveawayId)) return false;
  processingGiveaways.add(giveawayId);
  return true;
}

/**
 * Release the lock for a giveaway.
 * @param {number} giveawayId
 */
export function releaseGiveawayLock(giveawayId) {
  processingGiveaways.delete(giveawayId);
}
// ═════════════════════════════════════════════════════════════════
//  REVIEW EMBED (sent to staff)
// ═════════════════════════════════════════════════════════════════

/**
 * Build the pending review embed for staff.
 */
export function buildReviewEmbed(giveaway, creatorName) {
  const durationText = formatDuration(giveaway.duration_minutes);

  const embed = new EmbedBuilder()
    .setTitle('📋 Giveaway Pending Approval')
    .setColor(COLORS.WARNING)
    .addFields(
      { name: '🎁 Prize',       value: giveaway.prize,                 inline: true },
      { name: '👤 Created By',  value: creatorName,                    inline: true },
      { name: '🏆 Winners',     value: `${giveaway.winner_count}`,     inline: true },
      { name: '⏱️ Duration',    value: durationText,                   inline: true },
      { name: '🆔 Giveaway ID', value: `${giveaway.id}`,              inline: true },
    )
    .setTimestamp();

  if (giveaway.description?.trim()) {
    embed.addFields({ name: '📝 Description', value: giveaway.description.substring(0, 1024) });
  }

  embed.setFooter({ text: 'Approve to publish or reject with a reason' });

  return embed;
}

/**
 * Build the review action buttons.
 */
export function buildReviewButtons(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ga_approve_${giveawayId}`)
      .setLabel('Approve')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ga_reject_${giveawayId}`)
      .setLabel('Reject')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Build disabled review buttons (after decision).
 */
export function buildDisabledReviewButtons(giveawayId, decision) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ga_approve_${giveawayId}`)
      .setLabel(decision === 'approved' ? 'Approved ✅' : 'Approve')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`ga_reject_${giveawayId}`)
      .setLabel(decision === 'rejected' ? 'Rejected ❌' : 'Reject')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
}

// ═════════════════════════════════════════════════════════════════
//  SEND REVIEW TO STAFF VIA DM
// ═════════════════════════════════════════════════════════════════

/**
 * DM every staff member with the review embed + approve/reject buttons.
 * No longer posts in a channel.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} giveaway  DB row
 */
export async function sendStaffReview(guild, giveaway) {
  const creator = await guild.members.fetch(giveaway.creator_id).catch(() => null);
  const creatorName = creator?.displayName || 'Unknown User';

  const embed   = buildReviewEmbed(giveaway, creatorName);
  const buttons = buildReviewButtons(giveaway.id);

  const config = getGiveawayConfig(guild.id);
  if (!config) return;

  try {
    const staffRole = guild.roles.cache.get(config.staff_role_id);
    if (!staffRole) {
      console.warn('[GIVEAWAY] Staff role not found');
      return;
    }

    // Fetch all members with the staff role
    await guild.members.fetch();
    const members = staffRole.members;
    let sentCount = 0;

    for (const [, member] of members) {
      if (member.user.bot) continue;

      try {
        await member.send({
          content: `📋 **New giveaway pending approval in ${guild.name}!**`,
          embeds: [embed],
          components: [buttons],
        });
        sentCount++;
      } catch {
        // DMs disabled for this staff member
      }
    }

    console.log(`[GIVEAWAY] Sent review DM to ${sentCount}/${members.size} staff member(s)`);
  } catch (err) {
    console.warn('[GIVEAWAY] Could not DM staff:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY EMBED (published in giveaway channel)
// ═════════════════════════════════════════════════════════════════

/**
 * Build the public giveaway embed shown in the giveaway channel.
 */
export function buildGiveawayEmbed(giveaway, entryCount = 0, ended = false) {
  const embed = new EmbedBuilder()
    .setTimestamp();

  if (ended) {
    embed
      .setTitle('🎉 GIVEAWAY ENDED 🎉')
      .setColor(COLORS.NEUTRAL);
  } else {
    embed
      .setTitle('🎉 GIVEAWAY 🎉')
      .setColor(COLORS.SUCCESS);
  }

  embed.addFields(
    { name: '🎁 Prize', value: giveaway.prize, inline: false },
  );

  if (giveaway.description?.trim()) {
    embed.addFields({ name: '📝 Details', value: giveaway.description.substring(0, 1024), inline: false });
  }

  embed.addFields(
    { name: '🏆 Winners',  value: `${giveaway.winner_count}`,  inline: true },
    { name: '🎫 Entries',  value: `${entryCount}`,              inline: true },
  );

  if (!ended && giveaway.ends_at) {
    const epoch = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
    embed.addFields(
      { name: '⏰ Ends', value: `<t:${epoch}:R> (<t:${epoch}:F>)`, inline: false },
    );
  }

  if (ended) {
    embed.setFooter({ text: `Giveaway ID: ${giveaway.id} · Ended` });
  } else {
    embed.setFooter({ text: `Giveaway ID: ${giveaway.id} · Click the button to enter!` });
  }

  const creatorMention = `<@${giveaway.creator_id}>`;
  embed.addFields({ name: '🎗️ Hosted By', value: creatorMention, inline: true });

  return embed;
}

/**
 * Build the giveaway entry button.
 */
export function buildGiveawayButtons(giveawayId, ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ga_enter_${giveawayId}`)
      .setLabel(ended ? 'Giveaway Ended' : '🎉 Enter Giveaway')
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(ended),
  );
}

// ═════════════════════════════════════════════════════════════════
//  END GIVEAWAY + PICK WINNERS
// ═════════════════════════════════════════════════════════════════

/**
 * End a giveaway and pick random winner(s).
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} giveaway  DB row
 * @returns {Promise<string[]>}  Array of winner user IDs
 */
export async function endGiveaway(guild, giveaway) {
  // Mark as ended
  updateGiveawayEnd(giveaway.id);

  const entries  = getGiveawayEntries(giveaway.id);
  const winners  = pickWinners(entries, giveaway.winner_count);
  const fresh    = getGiveawayById(giveaway.id);

  // Update the giveaway message
  if (fresh.channel_id && fresh.message_id) {
    try {
      const channel = await guild.channels.fetch(fresh.channel_id).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(fresh.message_id).catch(() => null);
        if (msg) {
          const entryCount = entries.length;
          const embed   = buildGiveawayEmbed(fresh, entryCount, true);
          const buttons = buildGiveawayButtons(fresh.id, true);
          await msg.edit({ embeds: [embed], components: [buttons] });
        }

        // Announce winners
        if (winners.length > 0) {
          const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
          await channel.send({
            content: `🎉 **Congratulations** ${winnerMentions}!`,
            embeds: [
              new EmbedBuilder()
                .setTitle('🏆 Giveaway Winners!')
                .setColor(COLORS.SUCCESS)
                .setDescription(
                  `**Prize:** ${fresh.prize}\n` +
                  `**Winner(s):** ${winnerMentions}\n\n` +
                  `_Hosted by <@${fresh.creator_id}>_`,
                )
                .setFooter({ text: `Giveaway ID: ${fresh.id} · ${entries.length} total entries` })
                .setTimestamp(),
            ],
          });
        } else {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('😔 No Winners')
                .setColor(COLORS.NEUTRAL)
                .setDescription(`Nobody entered the giveaway for **${fresh.prize}**.`)
                .setTimestamp(),
            ],
          });
        }
      }
    } catch (err) {
      console.error('[GIVEAWAY] Could not update giveaway message:', err.message);
    }
  }

  // DM winners
  for (const winnerId of winners) {
    try {
      const member = await guild.members.fetch(winnerId).catch(() => null);
      if (member) {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('🎉 You Won a Giveaway!')
              .setColor(COLORS.SUCCESS)
              .setDescription(
                `Congratulations! You won **${fresh.prize}** in **${guild.name}**!\n\n` +
                `Contact <@${fresh.creator_id}> to claim your prize.`,
              )
              .setFooter({ text: guild.name })
              .setTimestamp(),
          ],
        });
      }
    } catch {
      // DMs disabled
    }
  }

  // DM creator
  try {
    const creator = await guild.members.fetch(fresh.creator_id).catch(() => null);
    if (creator) {
      const winnerText = winners.length > 0
        ? winners.map(id => `<@${id}>`).join(', ')
        : 'No entries — no winner';

      await creator.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎉 Your Giveaway Has Ended!')
            .setColor(COLORS.INFO)
            .setDescription(
              `Your giveaway for **${fresh.prize}** in **${guild.name}** has ended!\n\n` +
              `🏆 **Winner(s):** ${winnerText}\n` +
              `🎫 **Total Entries:** ${entries.length}`,
            )
            .setFooter({ text: guild.name })
            .setTimestamp(),
        ],
      });
    }
  } catch {
    // DMs disabled
  }

  console.log(`[GIVEAWAY] Ended #${fresh.id} "${fresh.prize}" — ${winners.length} winner(s) from ${entries.length} entries`);
  return winners;
}

// ═════════════════════════════════════════════════════════════════
//  REROLL WINNERS
// ═════════════════════════════════════════════════════════════════

/**
 * Pick new random winner(s) from existing entries.
 */
export async function rerollGiveaway(guild, giveaway) {
  const entries = getGiveawayEntries(giveaway.id);
  const winners = pickWinners(entries, giveaway.winner_count);

  if (giveaway.channel_id) {
    try {
      const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
      if (channel) {
        if (winners.length > 0) {
          const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
          await channel.send({
            content: `🔄 **Giveaway Rerolled!** ${winnerMentions}`,
            embeds: [
              new EmbedBuilder()
                .setTitle('🔄 Giveaway Rerolled!')
                .setColor(COLORS.SUCCESS)
                .setDescription(
                  `**Prize:** ${giveaway.prize}\n` +
                  `**New Winner(s):** ${winnerMentions}\n\n` +
                  `_Contact <@${giveaway.creator_id}> to claim!_`,
                )
                .setFooter({ text: `Giveaway ID: ${giveaway.id}` })
                .setTimestamp(),
            ],
          });
        } else {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('😔 Reroll Failed')
                .setColor(COLORS.NEUTRAL)
                .setDescription('No valid entries to pick from.')
                .setTimestamp(),
            ],
          });
        }
      }
    } catch (err) {
      console.error('[GIVEAWAY] Reroll failed:', err.message);
    }
  }

  // DM new winners
  for (const winnerId of winners) {
    try {
      const member = await guild.members.fetch(winnerId).catch(() => null);
      if (member) {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('🎉 You Won a Giveaway (Reroll)!')
              .setColor(COLORS.SUCCESS)
              .setDescription(
                `You were selected in a reroll for **${giveaway.prize}** in **${guild.name}**!\n\n` +
                `Contact <@${giveaway.creator_id}> to claim your prize.`,
              )
              .setFooter({ text: guild.name })
              .setTimestamp(),
          ],
        });
      }
    } catch {
      // DMs disabled
    }
  }

  console.log(`[GIVEAWAY] Rerolled #${giveaway.id} — ${winners.length} new winner(s)`);
  return winners;
}

// ═════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════

/**
 * Pick random winners from entries.
 * @param {object[]} entries
 * @param {number} count
 * @returns {string[]} Array of winner user IDs
 */
function pickWinners(entries, count) {
  if (entries.length === 0) return [];

  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const winners  = shuffled.slice(0, Math.min(count, entries.length));
  return winners.map(e => e.user_id);
}

/**
 * Format minutes into a readable duration string.
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} minute(s)`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h} hour(s)`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d} day(s)`;
}
