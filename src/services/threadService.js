// ─── src/services/threadService.js ───────────────────────────────
// Creates match threads, sends match embeds with action buttons,
// and notifies participants via DM.

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js";
import {
  getTournamentById,
  getParticipant,
  updateMatchThread,
  updateMatchStatus,
} from "../database/queries.js";
import { COLORS, MATCH_STATUS } from "../config.js";

// ═════════════════════════════════════════════════════════════════
//  CREATE A SINGLE MATCH THREAD
// ═════════════════════════════════════════════════════════════════

/**
 * Create a thread for a match inside the tournament's match channel.
 *
 *  1. Creates a public thread named "Round X — Match Y".
 *  2. Sends the match embed with Add Score + Disqualify buttons.
 *  3. Updates the match row with thread_id and score_message_id.
 *  4. Sets match status to in_progress.
 *  5. DMs both players about the match.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament  DB tournament row
 * @param {object} match       DB match row
 * @returns {Promise<import('discord.js').ThreadChannel|null>}
 */
export async function createMatchThread(guild, tournament, match) {
  if (!tournament.match_channel_id) {
    console.warn(
      "[THREAD] No match channel configured for tournament:",
      tournament.id,
    );
    return null;
  }

  try {
    // ── 1. Fetch match channel ─────────────────────────────────
    const matchChannel = await guild.channels.fetch(
      tournament.match_channel_id,
    );
    if (!matchChannel) {
      console.warn(
        "[THREAD] Match channel not found:",
        tournament.match_channel_id,
      );
      return null;
    }

    // ── 2. Fetch participant display names ─────────────────────
    const p1Data = getParticipant(tournament.id, match.player1_id);
    const p2Data = getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || "Player 1";
    const p2Name = p2Data?.display_name || p2Data?.username || "Player 2";

    // ── 3. Create thread ───────────────────────────────────────
    const threadName = `Round ${match.round} — Match ${match.match_number}`;
    const thread = await matchChannel.threads.create({
      name: threadName,
      type: ChannelType.PublicThread,
      reason: `Match: ${p1Name} vs ${p2Name}`,
    });

    // ── 4. Build match embed ───────────────────────────────────
    const matchEmbed = buildMatchEmbed(tournament, match, p1Name, p2Name);

    // ── 5. Build action buttons ────────────────────────────────
    const actionRow = buildMatchButtons(match.id);

    // ── 6. Send embed in thread ────────────────────────────────
    const scoreMessage = await thread.send({
      content: `⚔️ <@${match.player1_id}> vs <@${match.player2_id}>`,
      embeds: [matchEmbed],
      components: [actionRow],
    });

    // ── 7. Update DB with thread & message IDs ─────────────────
    updateMatchThread(match.id, thread.id, scoreMessage.id);
    updateMatchStatus(match.id, MATCH_STATUS.IN_PROGRESS);

    // ── 8. DM both players ─────────────────────────────────────
    await notifyPlayer(
      guild,
      match.player1_id,
      tournament,
      match,
      p2Name,
      thread,
    );
    await notifyPlayer(
      guild,
      match.player2_id,
      tournament,
      match,
      p1Name,
      thread,
    );

    console.log(
      `[THREAD] Created thread for Match #${match.match_number} (R${match.round}) in "${tournament.name}"`,
    );
    return thread;
  } catch (err) {
    console.error(
      `[THREAD] Failed to create thread for match ${match.id}:`,
      err.message,
    );
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════
//  CREATE MULTIPLE MATCH THREADS (batch)
// ═════════════════════════════════════════════════════════════════

/**
 * Create threads for an array of matches.
 * Processes sequentially to respect rate limits.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object}   tournament  DB tournament row
 * @param {object[]} matches     Array of DB match rows
 * @returns {Promise<number>}    Count of successfully created threads
 */
export async function createMatchThreads(guild, tournament, matches) {
  let created = 0;

  for (const match of matches) {
    const thread = await createMatchThread(guild, tournament, match);
    if (thread) created++;

    // Small delay between thread creations to avoid rate limits
    if (matches.length > 3) {
      await sleep(500);
    }
  }

  console.log(
    `[THREAD] Created ${created}/${matches.length} match threads for "${tournament.name}"`,
  );
  return created;
}

// ═════════════════════════════════════════════════════════════════
//  MATCH EMBED BUILDER
// ═════════════════════════════════════════════════════════════════

/**
 * Build the embed shown at the top of each match thread.
 *
 * @param {object} tournament
 * @param {object} match
 * @param {string} p1Name
 * @param {string} p2Name
 * @returns {EmbedBuilder}
 */
export function buildMatchEmbed(tournament, match, p1Name, p2Name) {
  const bestOf = tournament.best_of;

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${p1Name}  vs  ${p2Name}`)
    .setColor(COLORS.WARNING)
    .addFields(
      { name: "Tournament", value: tournament.name, inline: true },
      { name: "Round", value: `${match.round}`, inline: true },
      { name: "Match #", value: `${match.match_number}`, inline: true },
      { name: "Best Of", value: `${bestOf}`, inline: true },
      { name: "Status", value: "🟡 In Progress", inline: true },
    )
    .addFields({
      name: "📊 Score",
      value: formatScore(
        p1Name,
        match.player1_score,
        p2Name,
        match.player2_score,
      ),
      inline: false,
    })
    .setFooter({ text: `Match ID: ${match.id} · Admin: use buttons below` })
    .setTimestamp();

  return embed;
}

/**
 * Build the completed match embed (green, with winner).
 */
export function buildCompletedMatchEmbed(
  tournament,
  match,
  p1Name,
  p2Name,
  winnerName,
) {
  const embed = new EmbedBuilder()
    .setTitle(`✅ ${p1Name}  vs  ${p2Name}`)
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: "Tournament", value: tournament.name, inline: true },
      { name: "Round", value: `${match.round}`, inline: true },
      { name: "Match #", value: `${match.match_number}`, inline: true },
      { name: "Best Of", value: `${tournament.best_of}`, inline: true },
      { name: "Status", value: "✅ Completed", inline: true },
      { name: "🏆 Winner", value: winnerName, inline: true },
    )
    .addFields({
      name: "📊 Final Score",
      value: formatScore(
        p1Name,
        match.player1_score,
        p2Name,
        match.player2_score,
      ),
      inline: false,
    })
    .setFooter({ text: `Match ID: ${match.id}` })
    .setTimestamp();

  return embed;
}

// ═════════════════════════════════════════════════════════════════
//  MATCH BUTTONS
// ═════════════════════════════════════════════════════════════════

/**
 * Build the action row shown in match threads (for admins).
 * @param {number} matchId
 * @returns {ActionRowBuilder}
 */
export function buildMatchButtons(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`match_score_${matchId}`)
      .setLabel("Add Score")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`match_dq_${matchId}`)
      .setLabel("Disqualify")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Build a disabled button row (shown after match completes).
 * @param {number} matchId
 * @returns {ActionRowBuilder}
 */
export function buildDisabledMatchButtons(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`match_score_${matchId}`)
      .setLabel("Add Score")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`match_dq_${matchId}`)
      .setLabel("Disqualify")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
}

// ═════════════════════════════════════════════════════════════════
//  SCORE FORMATTING
// ═════════════════════════════════════════════════════════════════

/**
 * Format a readable score string.
 */
function formatScore(p1Name, p1Score, p2Name, p2Score) {
  const p1Bar = "🟦".repeat(p1Score) || "⬛";
  const p2Bar = "🟥".repeat(p2Score) || "⬛";

  return [
    `**${p1Name}:** ${p1Score} ${p1Bar}`,
    `**${p2Name}:** ${p2Score} ${p2Bar}`,
  ].join("\n");
}

// ═════════════════════════════════════════════════════════════════
//  PLAYER DM NOTIFICATION
// ═════════════════════════════════════════════════════════════════

/**
 * Send a DM to a player notifying them of a new match.
 * Includes a direct link to the match thread.
 * Silently fails if DMs are disabled.
 *
 * @param {import('discord.js').Guild}         guild
 * @param {string}                             userId
 * @param {object}                             tournament
 * @param {object}                             match
 * @param {string}                             opponentName
 * @param {import('discord.js').ThreadChannel} thread
 */
async function notifyPlayer(
  guild,
  userId,
  tournament,
  match,
  opponentName,
  thread,
) {
  try {
    const member = await guild.members.fetch(userId);
    if (!member) return;

    // Build thread URL — works as a clickable link in DMs
    const threadUrl = `https://discord.com/channels/${guild.id}/${thread.id}`;

    const embed = new EmbedBuilder()
      .setTitle("⚔️ New Match!")
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
      .setTimestamp();

    await member.send({ embeds: [embed] });
  } catch (err) {
    // DMs disabled or user not found — not critical
    console.warn(`[DM] Could not notify ${userId}:`, err.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  UPDATE MATCH THREAD EMBED  (after score change)
// ═════════════════════════════════════════════════════════════════

/**
 * Edit the score message in a match thread to reflect updated scores.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} tournament
 * @param {object} match         Updated match row from DB
 * @param {boolean} isCompleted  If true, use completed embed + disable buttons
 * @param {string|null} winnerName
 */

export async function updateMatchThreadEmbed(guild, tournament, match, isCompleted = false, winnerName = null) {
  if (!match.thread_id || !match.score_message_id) return;

  try {
    const thread = await guild.channels.fetch(match.thread_id);
    if (!thread) return;

    const msg = await thread.messages.fetch(match.score_message_id);
    if (!msg) return;

    const p1Data = getParticipant(tournament.id, match.player1_id);
    const p2Data = getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    if (isCompleted) {
      const embed = buildCompletedMatchEmbed(tournament, match, p1Name, p2Name, winnerName || 'Unknown');
      const buttons = buildDisabledMatchButtons(match.id);
      await msg.edit({ embeds: [embed], components: [buttons] });

      // ── Completion summary in thread ────────────────────────
      const loserName = match.winner_id === match.player1_id ? p2Name : p1Name;

      await thread.send({
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

      // ── Rename thread with status prefix ────────────────────
      const isDq = winnerName?.includes('DQ') || winnerName?.includes('dq');
      const prefix = isDq ? '⛔' : '✅ [FINISHED]';
      const shortWinner = (winnerName || 'Unknown').substring(0, 20);
      const newName = `${prefix} R${match.round}·M${match.match_number} — ${shortWinner} wins`;

      try {
        await thread.setName(newName);
      } catch (err) {
        console.warn(`[THREAD] Could not rename thread:`, err.message);
      }

      // ── Lock and archive ────────────────────────────────────
      try {
        await thread.setLocked(true, 'Match completed');
        await thread.setArchived(true, 'Match completed');
      } catch {
        // May lack permissions
      }

    } else {
      // ── Match still in progress — update score ──────────────
      const embed = buildMatchEmbed(tournament, match, p1Name, p2Name);
      const buttons = buildMatchButtons(match.id);
      await msg.edit({ embeds: [embed], components: [buttons] });
    }
  } catch (err) {
    console.warn(`[THREAD] Could not update match thread for match ${match.id}:`, err.message);
  }
}

/**
 * Mark a thread as cancelled (for DQ scenarios where thread exists).
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} match
 */
export async function markThreadCancelled(guild, match) {
  if (!match.thread_id) return;

  try {
    const thread = await guild.channels.fetch(match.thread_id);
    if (!thread) return;

    // Rename
    const newName = `❌ R${match.round}·M${match.match_number} — Cancelled`;
    try {
      await thread.setName(newName);
    } catch (err) {
      console.warn('[THREAD] Could not rename cancelled thread:', err.message);
    }

    // Post cancellation notice
    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setDescription('## ❌ Match Cancelled\n\n_This match has been cancelled due to a disqualification._')
          .setTimestamp(),
      ],
    });

    // Disable buttons if score message exists
    if (match.score_message_id) {
      try {
        const msg = await thread.messages.fetch(match.score_message_id);
        if (msg) {
          await msg.edit({
            components: [buildDisabledMatchButtons(match.id)],
          });
        }
      } catch {
        // Message may not exist
      }
    }

    // Lock and archive
    try {
      await thread.setLocked(true, 'Match cancelled');
      await thread.setArchived(true, 'Match cancelled');
    } catch {
      // May lack permissions
    }

  } catch (err) {
    console.warn(`[THREAD] Could not mark thread cancelled for match ${match.id}:`, err.message);
  }
}

// ── Simple sleep ─────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
