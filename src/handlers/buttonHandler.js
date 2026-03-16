// ─── src/handlers/buttonHandler.js ───────────────────────────────
import { EMBED_BUILDERS, buildHelpButtons } from '../commands/user/help.js';
import {
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { isOrganizer } from "../utils/permissions.js";
import {
    getTournamentById,
    getActiveParticipantCount,
    getMatchById,
    getParticipant,
    getGiveawayById,
    getGiveawayConfig,
    getGiveawayChannels,
    updateGiveawayApproval,
    hasEnteredGiveaway,
    addGiveawayEntry,
    removeGiveawayEntry,
    getGiveawayEntryCount,
} from "../database/queries.js";
import {
    COLORS,
    TOURNAMENT_STATUS,
    MAX_PLAYERS_LIMIT,
    VALID_BEST_OF,
    VALID_TEAM_SIZES,
} from "../config.js";
import {
    openRegistration,
    closeRegistration,
    startTournament,
    endTournament,
    deleteTournamentInfrastructure,
    refreshAdminPanel,
} from "../services/tournamentService.js";
import {
    registerParticipant,
    unregisterParticipant,
    registerSpectator,
} from "../services/registrationService.js";

import {
  acquireGiveawayLock,
  releaseGiveawayLock,
  buildDisabledReviewButtons,
} from '../services/giveawayService.js';
/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleButton(interaction) {
  const [category, action, ...rest] = interaction.customId.split('_');
  const targetId = rest.join('_');

  switch (category) {
    case 'admin':   return handleAdminButton(interaction, action, targetId);
    case 'reg':     return handleRegButton(interaction, action, targetId);
    case 'match':   return handleMatchButton(interaction, action, targetId);
    case 'confirm': return handleConfirmButton(interaction, action, targetId);
    case 'help':    return handleHelpButton(interaction, action);
    case 'ga':      return handleGiveawayButton(interaction, action, targetId);  // ← ADD
    default:
      console.warn(`[BTN] Unknown category: ${category} (${interaction.customId})`);
      await interaction.reply({ content: '❓ Unknown action.', flags: MessageFlags.Ephemeral });
  }
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleAdminButton(interaction, action, tournamentId) {
    if (!isOrganizer(interaction.member)) {
        return interaction.reply({
            content: "❌ Only organisers can use admin controls.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const tournament = getTournamentById(tournamentId);
    if (!tournament) {
        return interaction.reply({
            content: "❌ Tournament not found. It may have been deleted.",
            flags: MessageFlags.Ephemeral,
        });
    }

    switch (action) {
        case "configure":
            return showConfigureModal(interaction, tournament);
        case "openreg":
            return handleOpenReg(interaction, tournament);
        case "closereg":
            return handleCloseReg(interaction, tournament);
        case "start":
            return showStartConfirmation(interaction, tournament);
        case "end":
            return showEndConfirmation(interaction, tournament);
        case "delete":
            return showDeleteConfirmation(interaction, tournament);
        default:
            await interaction.reply({
                content: "❓ Unknown admin action.",
                flags: MessageFlags.Ephemeral,
            });
    }
}

async function showConfigureModal(interaction, tournament) {
    const status = tournament.status;
    if (
        [
            TOURNAMENT_STATUS.IN_PROGRESS,
            TOURNAMENT_STATUS.COMPLETED,
            TOURNAMENT_STATUS.CANCELLED,
        ].includes(status)
    ) {
        return interaction.reply({
            content:
            "❌ Cannot configure a tournament that has already started or ended.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`modal_configure_${tournament.id}`)
        .setTitle("Configure Tournament");

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId("tournament_name")
            .setLabel("Tournament Name")
            .setStyle(TextInputStyle.Short)
            .setValue(tournament.name)
            .setMinLength(2)
            .setMaxLength(50)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId("max_players")
            .setLabel("Max Players (2–100)")
            .setStyle(TextInputStyle.Short)
            .setValue(`${tournament.max_players}`)
            .setMinLength(1)
            .setMaxLength(3)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId("team_size")
            .setLabel("Team Size (1 = Solo, 2 = Duo)")
            .setStyle(TextInputStyle.Short)
            .setValue(`${tournament.team_size}`)
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId("best_of")
            .setLabel(`Best Of (${VALID_BEST_OF.join(" or ")})`)
            .setStyle(TextInputStyle.Short)
            .setValue(`${tournament.best_of}`)
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId("rules")
            .setLabel("Rules (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(tournament.rules || "")
            .setMaxLength(1000)
            .setRequired(false),
        ),
    );

    await interaction.showModal(modal);
}

async function handleOpenReg(interaction, tournament) {
    if (
        ![
            TOURNAMENT_STATUS.CREATED,
            TOURNAMENT_STATUS.REGISTRATION_CLOSED,
        ].includes(tournament.status)
    ) {
        return interaction.reply({
            content:
            "❌ Registration can only be opened when the tournament is in **Created** or **Registration Closed** state.",
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        await openRegistration(interaction.guild, tournament);
        await interaction.editReply({
            content: "✅ Registration is now **open**!",
        });
    } catch (err) {
        console.error("[OPENREG]", err);
        await interaction.editReply({ content: `❌ Failed: ${err.message}` });
    }
}

async function handleCloseReg(interaction, tournament) {
    if (tournament.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
        return interaction.reply({
            content: "❌ Registration is not currently open.",
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        await closeRegistration(interaction.guild, tournament);
        await interaction.editReply({
            content: "✅ Registration is now **closed**.",
        });
    } catch (err) {
        console.error("[CLOSEREG]", err);
        await interaction.editReply({ content: `❌ Failed: ${err.message}` });
    }
}

async function showStartConfirmation(interaction, tournament) {
    if (tournament.status !== TOURNAMENT_STATUS.REGISTRATION_CLOSED) {
        return interaction.reply({
            content: "❌ Close registration before starting the tournament.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const playerCount = getActiveParticipantCount(tournament.id);
    if (playerCount < 2) {
        return interaction.reply({
            content: `❌ At least **2** participants needed. Currently: **${playerCount}**.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    const totalMatches = (playerCount * (playerCount - 1)) / 2;

    const embed = new EmbedBuilder()
        .setTitle("⚠️ Start Tournament?")
        .setColor(COLORS.WARNING)
        .setDescription(
            `Are you sure you want to start **${tournament.name}**?\n\n` +
            `👥 **${playerCount}** participants\n` +
            `⚔️ **${totalMatches}** matches will be generated\n` +
            `📋 Format: Round Robin · Best of ${tournament.best_of}\n\n` +
            `This action cannot be undone.`,
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId(`confirm_start_${tournament.id}`)
        .setLabel("Start Tournament")
        .setEmoji("🚀")
        .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
        .setCustomId(`confirm_no_${tournament.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

async function showEndConfirmation(interaction, tournament) {
    if (tournament.status !== TOURNAMENT_STATUS.IN_PROGRESS) {
        return interaction.reply({
            content: "❌ The tournament is not in progress.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle("⚠️ End Tournament?")
        .setColor(COLORS.WARNING)
        .setDescription(
            `Are you sure you want to end **${tournament.name}**?\n\n` +
            `All remaining matches will be **cancelled**.\nFinal standings based on completed matches.`,
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId(`confirm_end_${tournament.id}`)
        .setLabel("End Tournament")
        .setEmoji("🏁")
        .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
        .setCustomId(`confirm_no_${tournament.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

async function showDeleteConfirmation(interaction, tournament) {
    const embed = new EmbedBuilder()
        .setTitle("⚠️ Delete Tournament?")
        .setColor(COLORS.DANGER)
        .setDescription(
            `This will **permanently delete** all channels, roles, and data for **${tournament.name}**.\n\n` +
            `⚠️ **This action cannot be undone!**`,
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId(`confirm_delete_${tournament.id}`)
        .setLabel("Delete Permanently")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
        .setCustomId(`confirm_no_${tournament.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

// ═════════════════════════════════════════════════════════════════
//  CONFIRMATION BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleConfirmButton(interaction, action, targetId) {
    if (action === "no") {
        return interaction.update({
            content: "❌ Action cancelled.",
            embeds: [],
            components: [],
        });
    }

    const tournament = getTournamentById(targetId);
    if (!tournament) {
        return interaction.update({
            content: "❌ Tournament not found.",
            embeds: [],
            components: [],
        });
    }

    switch (action) {
        case "start":
            return executeStart(interaction, tournament);
        case "end":
            return executeEnd(interaction, tournament);
        case "delete":
            return executeDelete(interaction, tournament);
        default:
            await interaction.update({
                content: "❓ Unknown action.",
                embeds: [],
                components: [],
            });
    }
}

async function executeStart(interaction, tournament) {
    await interaction.update({
        content: "⏳ Generating matches and starting tournament…",
        embeds: [],
        components: [],
    });
    try {
        await startTournament(interaction.guild, tournament);
        await interaction.editReply({
            content:
            "✅ Tournament has **started**! Match threads are being created.",
        });
    } catch (err) {
        console.error("[START]", err);
        await interaction.editReply({ content: `❌ Failed: ${err.message}` });
    }
}

async function executeEnd(interaction, tournament) {
    await interaction.update({
        content: "⏳ Ending tournament…",
        embeds: [],
        components: [],
    });
    try {
        await endTournament(interaction.guild, tournament);
        await interaction.editReply({ content: "✅ Tournament has **ended**!" });
    } catch (err) {
        console.error("[END]", err);
        await interaction.editReply({ content: `❌ Failed: ${err.message}` });
    }
}

async function executeDelete(interaction, tournament) {
    await interaction.update({
        content: "⏳ Deleting tournament…",
        embeds: [],
        components: [],
    });
    try {
        await deleteTournamentInfrastructure(interaction.guild, tournament);
        try {
            await interaction.editReply({ content: "✅ Tournament **deleted**." });
        } catch {
            /* channel gone */
        }
    } catch (err) {
        console.error("[DELETE]", err);
        try {
            await interaction.editReply({ content: `❌ Failed: ${err.message}` });
        } catch {
            /* channel gone */
        }
    }
}

// ═════════════════════════════════════════════════════════════════
//  REGISTRATION BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleRegButton(interaction, action, tournamentId) {
    const tournament = getTournamentById(tournamentId);
    if (!tournament) {
        return interaction.reply({
            content: "❌ Tournament not found.",
            flags: MessageFlags.Ephemeral,
        });
    }

    let member;
    try {
        member = await interaction.guild.members.fetch(interaction.user.id);
    } catch {
        return interaction.reply({
            content: "❌ Could not fetch your profile.",
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let result;
    switch (action) {
        case "register":
            result = await registerParticipant(
                interaction.guild,
                tournament,
                interaction.user,
                member,
            );
            break;
        case "unregister":
            result = await unregisterParticipant(
                interaction.guild,
                tournament,
                interaction.user,
                member,
            );
            break;
        case "spectate":
            result = await registerSpectator(
                interaction.guild,
                tournament,
                interaction.user,
                member,
            );
            break;
        default:
            return interaction.editReply({ content: "❓ Unknown action." });
    }

    await interaction.editReply({ content: result.message });
}

// ═════════════════════════════════════════════════════════════════
//  MATCH BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleMatchButton(interaction, action, targetId) {
    switch (action) {
        case "score":
            return showScoreModal(interaction, targetId);
        case "dq":
            return showDqPlayerSelect(interaction, targetId);
        case "dqp":
            return executeDqFromMatch(interaction, targetId);
        default:
            await interaction.reply({
                content: "❓ Unknown match action.",
                flags: MessageFlags.Ephemeral,
            });
    }
}

// ── Score Modal ──────────────────────────────────────────────────

async function showScoreModal(interaction, matchId) {
    if (!isOrganizer(interaction.member)) {
        return interaction.reply({ content: '❌ Only organisers can record scores.', flags: MessageFlags.Ephemeral });
    }

    const match = getMatchById(parseInt(matchId, 10));
    if (!match) {
        return interaction.reply({ content: '❌ Match not found.', flags: MessageFlags.Ephemeral });
    }

    if (match.status === 'completed') {
        return interaction.reply({ content: '❌ This match is already completed.', flags: MessageFlags.Ephemeral });
    }

    if (match.status === 'cancelled') {
        return interaction.reply({ content: '❌ This match has been cancelled.', flags: MessageFlags.Ephemeral });
    }

    const tournament = getTournamentById(match.tournament_id);
    if (!tournament) {
        return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });
    }

    const p1Data = getParticipant(tournament.id, match.player1_id);
    const p2Data = getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    // Truncate names to fit Discord's 45-char label limit
    // Format: "1 = Name1, 2 = Name2" must fit in 45 chars
    // Reserve 10 chars for "1 = " and ", 2 = " → 35 chars for both names
    const maxNameLen = 15;
    const short1 = p1Name.length > maxNameLen ? p1Name.substring(0, maxNameLen - 1) + '…' : p1Name;
    const short2 = p2Name.length > maxNameLen ? p2Name.substring(0, maxNameLen - 1) + '…' : p2Name;

    const modal = new ModalBuilder()
        .setCustomId(`modal_score_${match.id}`)
        .setTitle('Record Game Result');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId('winner')
            .setLabel(`1 = ${short1}, 2 = ${short2}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Enter 1 for ${short1} or 2 for ${short2}`)
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true),
        ),
    );

    await interaction.showModal(modal);
}

// ── DQ Player Select ─────────────────────────────────────────────

async function showDqPlayerSelect(interaction, matchId) {
    if (!isOrganizer(interaction.member)) {
        return interaction.reply({ content: '❌ Only organisers can disqualify players.', flags: MessageFlags.Ephemeral });
    }

    const match = getMatchById(parseInt(matchId, 10));
    if (!match) {
        return interaction.reply({ content: '❌ Match not found.', flags: MessageFlags.Ephemeral });
    }

    if (match.status === 'completed' || match.status === 'cancelled') {
        return interaction.reply({ content: '❌ This match is already finished.', flags: MessageFlags.Ephemeral });
    }

    const tournament = getTournamentById(match.tournament_id);
    if (!tournament) {
        return interaction.reply({ content: '❌ Tournament not found.', flags: MessageFlags.Ephemeral });
    }

    const p1Data = getParticipant(tournament.id, match.player1_id);
    const p2Data = getParticipant(tournament.id, match.player2_id);
    const p1Name = p1Data?.display_name || p1Data?.username || 'Player 1';
    const p2Name = p2Data?.display_name || p2Data?.username || 'Player 2';

    const p1Short = p1Name.length > 20 ? p1Name.substring(0, 19) + '…' : p1Name;
    const p2Short = p2Name.length > 20 ? p2Name.substring(0, 19) + '…' : p2Name;

    const embed = new EmbedBuilder()
        .setTitle('⛔ Disqualify Player')
        .setColor(COLORS.DANGER)
        .setDescription(
            `Select which player to disqualify from **${tournament.name}**.\n\n` +
            `**Player 1:** ${p1Name} (<@${match.player1_id}>)\n` +
            `**Player 2:** ${p2Name} (<@${match.player2_id}>)\n\n` +
            `⚠️ This will:\n` +
            `• Mark them as disqualified\n` +
            `• Forfeit ALL their remaining matches\n` +
            `• Award wins to all their opponents\n` +
            `• Remove their participant role\n\n` +
            `**This cannot be undone!**`,
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId(`match_dqp_${match.id}:${match.player1_id}`)
        .setLabel(`DQ ${p1Short}`)
        .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
        .setCustomId(`match_dqp_${match.id}:${match.player2_id}`)
        .setLabel(`DQ ${p2Short}`)
        .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
        .setCustomId(`confirm_no_cancel`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}
// ── Execute DQ from Match — Show Reason Modal ────────────────────

async function executeDqFromMatch(interaction, encodedId) {
    if (!isOrganizer(interaction.member)) {
        return interaction.reply({
            content: "❌ Only organisers can disqualify players.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const [matchIdStr, targetUserId] = encodedId.split(":");

    if (!targetUserId) {
        return interaction.reply({
            content: "❌ Invalid disqualification target.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const match = getMatchById(parseInt(matchIdStr, 10));
    if (!match) {
        return interaction.reply({
            content: "❌ Match not found.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const tournament = getTournamentById(match.tournament_id);
    if (!tournament) {
        return interaction.reply({
            content: "❌ Tournament not found.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const targetData = getParticipant(tournament.id, targetUserId);
    const targetName = targetData?.display_name || targetData?.username || 'Unknown';
    const shortName  = targetName.length > 30 ? targetName.substring(0, 29) + '…' : targetName;

    const modal = new ModalBuilder()
        .setCustomId(`modal_dq_${match.id}:${targetUserId}`)
        .setTitle(`DQ ${shortName}`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for disqualification')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('e.g. Cheating, inactivity, rule violation…')
            .setMaxLength(200)
            .setRequired(true),
        ),
    );

    await interaction.showModal(modal);
}

// ═════════════════════════════════════════════════════════════════
//  HELP BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleHelpButton(interaction, category) {
  const builder = EMBED_BUILDERS[category];
  if (!builder) {
    return interaction.reply({ content: '❓ Unknown help category.', flags: MessageFlags.Ephemeral });
  }

  const embed   = builder();
  const buttons = buildHelpButtons(category);

  await interaction.update({
    embeds: [embed],
    components: [buttons],
  });
}

// ═════════════════════════════════════════════════════════════════
//  GIVEAWAY BUTTONS
// ═════════════════════════════════════════════════════════════════

async function handleGiveawayButton(interaction, action, targetId) {
  switch (action) {
    case 'approve': return handleGiveawayApprove(interaction, targetId);
    case 'reject':  return handleGiveawayReject(interaction, targetId);
    case 'enter':   return handleGiveawayEnter(interaction, targetId);
    case 'channel': return handleGiveawayChannelSelect(interaction, targetId);
    default:
      await interaction.reply({ content: '❓ Unknown giveaway action.', flags: MessageFlags.Ephemeral });
  }
}

// ── Approve: Show channel selection ──────────────────────────────

async function handleGiveawayApprove(interaction, giveawayId) {
  const id       = parseInt(giveawayId, 10);
  const giveaway = getGiveawayById(id);

  if (!giveaway) {
    return interaction.update({
      content: '❌ Giveaway not found.',
      embeds: [],
      components: [],
    });
  }

  // ── Race condition check ───────────────────────────────────
  if (giveaway.status !== 'pending') {
    const statusMsg = giveaway.status === 'approved'
      ? '✅ This giveaway has already been **approved** by another staff member.'
      : '❌ This giveaway has already been **rejected** by another staff member.';

    return interaction.update({
      content: statusMsg,
      embeds: [],
      components: [buildDisabledReviewButtons(id, giveaway.status === 'approved' ? 'approved' : 'rejected')],
    });
  }

  // Fetch guild from giveaway data
  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) {
    return interaction.reply({ content: '❌ Could not find the server.', flags: MessageFlags.Ephemeral });
  }

  const config = getGiveawayConfig(giveaway.guild_id);
  if (!config) {
    return interaction.reply({ content: '❌ Giveaway system not configured.', flags: MessageFlags.Ephemeral });
  }

  // Verify staff role
  try {
    const member = await guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.staff_role_id) &&
        !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Only giveaway staff can approve.', flags: MessageFlags.Ephemeral });
    }
  } catch {
    return interaction.reply({ content: '❌ Could not verify your permissions.', flags: MessageFlags.Ephemeral });
  }

  // Show channel selection buttons
  const channels = getGiveawayChannels(giveaway.guild_id);
  if (channels.length === 0) {
    return interaction.reply({ content: '❌ No giveaway channels configured.', flags: MessageFlags.Ephemeral });
  }

  const rows = [];
  const row  = new ActionRowBuilder();

  for (let i = 0; i < channels.length && i < 5; i++) {
    const ch = guild.channels.cache.get(channels[i].channel_id);
    const label = ch ? `#${ch.name}` : 'Unknown';
    const safeLbl = label.length > 40 ? label.substring(0, 39) + '…' : label;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ga_channel_${giveawayId}:${channels[i].channel_id}`)
        .setLabel(safeLbl)
        .setEmoji('📢')
        .setStyle(ButtonStyle.Primary),
    );
  }
  rows.push(row);

  if (channels.length > 5) {
    const row2 = new ActionRowBuilder();
    for (let i = 5; i < channels.length && i < 10; i++) {
      const ch = guild.channels.cache.get(channels[i].channel_id);
      const label = ch ? `#${ch.name}` : 'Unknown';
      const safeLbl = label.length > 40 ? label.substring(0, 39) + '…' : label;

      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(`ga_channel_${giveawayId}:${channels[i].channel_id}`)
          .setLabel(safeLbl)
          .setEmoji('📢')
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row2);
  }

  await interaction.update({
    content: `📢 **Select which channel** to publish giveaway **#${giveawayId}** in:`,
    embeds: [],
    components: rows,
  });
}

// ── Channel Selected: Publish giveaway ───────────────────────────

async function handleGiveawayChannelSelect(interaction, encodedId) {
  const [giveawayIdStr, channelId] = encodedId.split(':');
  const giveawayId = parseInt(giveawayIdStr, 10);

  const giveaway = getGiveawayById(giveawayId);

  if (!giveaway) {
    return interaction.update({
      content: '❌ Giveaway not found.',
      components: [],
    });
  }

  // ── Race condition check ───────────────────────────────────
  if (giveaway.status !== 'pending') {
    return interaction.update({
      content: '⚠️ This giveaway has already been processed by another staff member.',
      components: [],
    });
  }

  // ── Acquire lock ───────────────────────────────────────────
  if (!acquireGiveawayLock(giveawayId)) {
    return interaction.update({
      content: '⏳ Another staff member is already processing this giveaway. Please wait.',
      components: [],
    });
  }

  await interaction.update({
    content: '⏳ Publishing giveaway…',
    components: [],
  });

  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) {
    releaseGiveawayLock(giveawayId);
    return interaction.editReply({ content: '❌ Could not find the server.' });
  }

  try {
    // Double-check status (in case it changed between lock and here)
    const freshGiveaway = getGiveawayById(giveawayId);
    if (freshGiveaway.status !== 'pending') {
      releaseGiveawayLock(giveawayId);
      return interaction.editReply({ content: '⚠️ This giveaway was already processed.' });
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      releaseGiveawayLock(giveawayId);
      return interaction.editReply({ content: '❌ Channel not found.' });
    }

    // Calculate end time
    const endsAt = new Date(Date.now() + giveaway.duration_minutes * 60 * 1000).toISOString();

    // Determine ping content
    const config = getGiveawayConfig(giveaway.guild_id);
    let pingContent;
    if (config?.ping_role_id) {
      pingContent = `<@&${config.ping_role_id}>`;
    } else {
      pingContent = '@everyone';
    }

    // Build and send giveaway embed
    const { buildGiveawayEmbed, buildGiveawayButtons } = await import('../services/giveawayService.js');
    const embed   = buildGiveawayEmbed({ ...giveaway, ends_at: endsAt }, 0, false);
    const buttons = buildGiveawayButtons(giveaway.id, false);

    const giveawayMsg = await channel.send({
      content: pingContent,
      embeds: [embed],
      components: [buttons],
      allowedMentions: {
        parse: ['everyone'],
        roles: config?.ping_role_id ? [config.ping_role_id] : [],
      },
    });

    // Update DB
    const { updateGiveawayApproval: updateApproval } = await import('../database/queries.js');
    updateApproval(giveaway.id, {
      channelId: channel.id,
      messageId: giveawayMsg.id,
      endsAt,
    });

    // DM creator
    try {
      const creator = await guild.members.fetch(giveaway.creator_id).catch(() => null);
      if (creator) {
        const epoch = Math.floor(new Date(endsAt).getTime() / 1000);
        await creator.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('✅ Your Giveaway Was Approved!')
              .setColor(COLORS.SUCCESS)
              .setDescription(
                `Your giveaway for **${giveaway.prize}** has been approved and published!\n\n` +
                `📢 **Channel:** <#${channel.id}>\n` +
                `⏰ **Ends:** <t:${epoch}:R>\n` +
                `✅ **Approved by:** ${interaction.user.displayName}`,
              )
              .setFooter({ text: guild.name })
              .setTimestamp(),
          ],
        });
      }
    } catch {
      // DMs disabled
    }

    const pingLabel = config?.ping_role_id ? `<@&${config.ping_role_id}>` : '@everyone';
    await interaction.editReply({
      content: `✅ Giveaway **#${giveaway.id}** published in <#${channel.id}> with ${pingLabel} ping!`,
    });

    console.log(`[GIVEAWAY] #${giveaway.id} approved by ${interaction.user.username} → #${channel.name}`);

  } catch (err) {
    console.error('[GIVEAWAY] Publish failed:', err);
    await interaction.editReply({ content: `❌ Failed to publish: ${err.message}` });
  } finally {
    releaseGiveawayLock(giveawayId);
  }
}

// ── Reject: Show reason modal ────────────────────────────────────

async function handleGiveawayReject(interaction, giveawayId) {
  const id       = parseInt(giveawayId, 10);
  const giveaway = getGiveawayById(id);

  if (!giveaway) {
    return interaction.update({
      content: '❌ Giveaway not found.',
      embeds: [],
      components: [],
    });
  }

  // ── Race condition check ───────────────────────────────────
  if (giveaway.status !== 'pending') {
    const statusMsg = giveaway.status === 'approved'
      ? '✅ This giveaway has already been **approved** by another staff member.'
      : '❌ This giveaway has already been **rejected** by another staff member.';

    return interaction.update({
      content: statusMsg,
      embeds: [],
      components: [buildDisabledReviewButtons(id, giveaway.status === 'approved' ? 'approved' : 'rejected')],
    });
  }

  // Fetch guild and verify staff
  const guild = interaction.client.guilds.cache.get(giveaway.guild_id);
  if (!guild) {
    return interaction.reply({ content: '❌ Could not find the server.', flags: MessageFlags.Ephemeral });
  }

  const config = getGiveawayConfig(giveaway.guild_id);
  if (!config) {
    return interaction.reply({ content: '❌ Giveaway system not configured.', flags: MessageFlags.Ephemeral });
  }

  try {
    const member = await guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.staff_role_id) &&
        !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Only giveaway staff can reject.', flags: MessageFlags.Ephemeral });
    }
  } catch {
    return interaction.reply({ content: '❌ Could not verify your permissions.', flags: MessageFlags.Ephemeral });
  }

  // Show reason modal
  const modal = new ModalBuilder()
    .setCustomId(`modal_gareject_${giveawayId}`)
    .setTitle('Reject Giveaway');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for rejection')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Explain why this giveaway is being rejected...')
        .setMaxLength(300)
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

// ── Enter giveaway — stub for G4 ────────────────────────────────

async function handleGiveawayEnter(interaction, giveawayId) {
  const id       = parseInt(giveawayId, 10);
  const giveaway = getGiveawayById(id);

  if (!giveaway) {
    return interaction.reply({
      content: '❌ This giveaway no longer exists.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (giveaway.status !== 'approved') {
    return interaction.reply({
      content: '❌ This giveaway has ended.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Check if ended by time
  if (giveaway.ends_at && new Date(giveaway.ends_at) <= new Date()) {
    return interaction.reply({
      content: '❌ This giveaway has expired. Winners will be announced shortly.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;

  // Prevent creator from entering their own giveaway
  if (giveaway.creator_id === userId) {
    return interaction.reply({
      content: '❌ You cannot enter your own giveaway!',
      flags: MessageFlags.Ephemeral,
    });
  }

  const {
    hasEnteredGiveaway,
    addGiveawayEntry,
    removeGiveawayEntry,
    getGiveawayEntryCount,
  } = await import('../database/queries.js');

  const alreadyEntered = hasEnteredGiveaway(id, userId);

  if (alreadyEntered) {
    // Toggle — remove entry
    removeGiveawayEntry(id, userId);
    const newCount = getGiveawayEntryCount(id);

    // Update embed with new count
    await updateGiveawayEmbed(interaction, giveaway, newCount);

    return interaction.reply({
      content: `❌ You have **left** the giveaway for **${giveaway.prize}**.\nClick the button again to re-enter.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Add entry
  addGiveawayEntry(id, userId);
  const newCount = getGiveawayEntryCount(id);

  // Update embed with new count
  await updateGiveawayEmbed(interaction, giveaway, newCount);

  const epoch = giveaway.ends_at
    ? Math.floor(new Date(giveaway.ends_at).getTime() / 1000)
    : null;

  const timeText = epoch ? `\n⏰ Ends <t:${epoch}:R>` : '';

  return interaction.reply({
    content:
      `✅ You have **entered** the giveaway for **${giveaway.prize}**! 🎉\n` +
      `🎫 Total entries: **${newCount}**${timeText}\n\n` +
      `_Click the button again to leave the giveaway._`,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Update the giveaway message embed with new entry count.
 * Does NOT reply to interaction — caller handles that.
 */
async function updateGiveawayEmbed(interaction, giveaway, entryCount) {
  try {
    // If interaction is from a guild channel, we can edit directly
    // If from DM somehow, skip
    const msg = interaction.message;
    if (!msg) return;

    const { buildGiveawayEmbed, buildGiveawayButtons } = await import('../services/giveawayService.js');
    const embed   = buildGiveawayEmbed(giveaway, entryCount, false);
    const buttons = buildGiveawayButtons(giveaway.id, false);

    await msg.edit({
      embeds: [embed],
      components: [buttons],
    });
  } catch (err) {
    // Message may have been deleted — not critical
    console.warn('[GIVEAWAY] Could not update entry count:', err.message);
  }
}
