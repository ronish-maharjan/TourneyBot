// ─── src/services/registrationService.js ─────────────────────────
// Handles participant registration, unregistration, and spectator logic.

// ─── src/services/registrationService.js ─────────────────────────
// Handles participant registration, unregistration, and spectator logic.

import { EmbedBuilder } from "discord.js";
import { acquireLock, releaseLock } from './lockService.js';
import {
  getTournamentById,
  getParticipant,
  addParticipant,
  removeParticipant,
  updateParticipantRole,
  getParticipantCount,
  getActiveParticipantCount,
} from "../database/queries.js";
import { TOURNAMENT_STATUS, PARTICIPANT_ROLE, COLORS } from "../config.js";
import {
  refreshParticipationList,
  refreshRegistrationMessage,
  sendTournamentNotice,
} from "./tournamentService.js";

// ═════════════════════════════════════════════════════════════════
//  REGISTER
// ═════════════════════════════════════════════════════════════════

/**
 * Register a user as a tournament participant.
 *
 * @param {import('discord.js').Guild}  guild
 * @param {object}                      tournament   DB row
 * @param {import('discord.js').User}   user         Discord user
 * @param {import('discord.js').GuildMember} member   Guild member
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function registerParticipant(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) {
    return { success: false, message: '⏳ Your registration is being processed. Please wait.' };
  }

  try {
    // Fresh status check
    const fresh = getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
      return { success: false, message: '❌ Registration is not currently open.' };
    }

    const existing = getParticipant(tournament.id, user.id);

    if (existing) {
      if (existing.role === PARTICIPANT_ROLE.SPECTATOR) {
        const result = await switchToParticipant(guild, fresh, user, member);
        return result;
      }
      return { success: false, message: '❌ You are already registered as a participant.' };
    }

    const currentCount = getParticipantCount(tournament.id);
    if (currentCount >= fresh.max_players) {
      return { success: false, message: `❌ This tournament is full (**${fresh.max_players}** max players).` };
    }

    try {
      addParticipant({
        tournamentId: tournament.id,
        userId:       user.id,
        username:     user.username,
        displayName:  member.displayName || user.displayName || user.username,
        role:         PARTICIPANT_ROLE.PARTICIPANT,
      });
    } catch (err) {
      console.error('[REGISTER] DB insert failed:', err.message);
      return { success: false, message: '❌ Registration failed. Please try again.' };
    }

    try {
      if (fresh.participant_role_id) {
        await member.roles.add(fresh.participant_role_id, `Registered for ${fresh.name}`);
      }
      if (fresh.spectator_role_id && member.roles.cache.has(fresh.spectator_role_id)) {
        await member.roles.remove(fresh.spectator_role_id, `Switched to participant for ${fresh.name}`);
      }
    } catch (err) {
      console.warn('[REGISTER] Could not assign role:', err.message);
    }

    const updated = getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);
    await refreshRegistrationMessage(guild, updated);

    const newCount = getParticipantCount(tournament.id);
    return {
      success: true,
      message: `✅ You have been registered for **${fresh.name}**! (${newCount}/${fresh.max_players})`,
    };

  } finally {
    releaseLock(lockKey);
  }
}

// ═════════════════════════════════════════════════════════════════
//  UNREGISTER
// ═════════════════════════════════════════════════════════════════

/**
 * Unregister a user from a tournament.
 *
 * @param {import('discord.js').Guild}       guild
 * @param {object}                           tournament   DB row
 * @param {import('discord.js').User}        user
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function unregisterParticipant(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) {
    return { success: false, message: '⏳ Your request is being processed. Please wait.' };
  }

  try {
    const fresh = getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
      return { success: false, message: '❌ Registration is not currently open. You cannot unregister.' };
    }

    const existing = getParticipant(tournament.id, user.id);
    if (!existing) {
      return { success: false, message: '❌ You are not registered for this tournament.' };
    }

    try {
      removeParticipant(tournament.id, user.id);
    } catch (err) {
      console.error('[UNREGISTER] DB delete failed:', err.message);
      return { success: false, message: '❌ Failed to unregister. Please try again.' };
    }

    try {
      if (fresh.participant_role_id && member.roles.cache.has(fresh.participant_role_id)) {
        await member.roles.remove(fresh.participant_role_id, `Unregistered from ${fresh.name}`);
      }
      if (fresh.spectator_role_id && member.roles.cache.has(fresh.spectator_role_id)) {
        await member.roles.remove(fresh.spectator_role_id, `Unregistered from ${fresh.name}`);
      }
    } catch (err) {
      console.warn('[UNREGISTER] Could not remove role:', err.message);
    }

    const updated = getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);
    await refreshRegistrationMessage(guild, updated);

    return { success: true, message: `✅ You have been unregistered from **${fresh.name}**.` };

  } finally {
    releaseLock(lockKey);
  }
}

// ═════════════════════════════════════════════════════════════════
//  SPECTATE
// ═════════════════════════════════════════════════════════════════

/**
 * Register a user as a spectator (or switch from participant to spectator).
 *
 * @param {import('discord.js').Guild}       guild
 * @param {object}                           tournament   DB row
 * @param {import('discord.js').User}        user
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function registerSpectator(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) {
    return { success: false, message: '⏳ Your request is being processed. Please wait.' };
  }

  try {
    const fresh = getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) {
      return { success: false, message: '❌ Registration is not currently open.' };
    }

    const existing = getParticipant(tournament.id, user.id);

    if (existing) {
      if (existing.role === PARTICIPANT_ROLE.SPECTATOR) {
        return { success: false, message: '❌ You are already registered as a spectator.' };
      }
      const result = await switchToSpectator(guild, fresh, user, member);
      return result;
    }

    try {
      addParticipant({
        tournamentId: tournament.id,
        userId:       user.id,
        username:     user.username,
        displayName:  member.displayName || user.displayName || user.username,
        role:         PARTICIPANT_ROLE.SPECTATOR,
      });
    } catch (err) {
      console.error('[SPECTATE] DB insert failed:', err.message);
      return { success: false, message: '❌ Failed to register as spectator. Please try again.' };
    }

    try {
      if (fresh.spectator_role_id) {
        await member.roles.add(fresh.spectator_role_id, `Spectating ${fresh.name}`);
      }
    } catch (err) {
      console.warn('[SPECTATE] Could not assign role:', err.message);
    }

    const updated = getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);

    return { success: true, message: `👁️ You are now a spectator for **${fresh.name}**.` };

  } finally {
    releaseLock(lockKey);
  }
}

// ═════════════════════════════════════════════════════════════════
//  ROLE SWITCHING HELPERS
// ═════════════════════════════════════════════════════════════════

/**
 * Switch an existing spectator to participant.
 */
async function switchToParticipant(guild, tournament, user, member) {
  // Max player check (spectators don't count toward player limit)
  const currentCount = getParticipantCount(tournament.id);
  if (currentCount >= tournament.max_players) {
    return {
      success: false,
      message: `❌ This tournament is full (**${tournament.max_players}** max players).`,
    };
  }

  try {
    updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.PARTICIPANT);
  } catch (err) {
    console.error("[SWITCH] DB update failed:", err.message);
    return {
      success: false,
      message: "❌ Failed to switch role. Please try again.",
    };
  }

  // ── Swap roles ─────────────────────────────────────────────
  try {
    if (tournament.participant_role_id) {
      await member.roles.add(
        tournament.participant_role_id,
        `Switched to participant for ${tournament.name}`,
      );
    }
    if (
      tournament.spectator_role_id &&
      member.roles.cache.has(tournament.spectator_role_id)
    ) {
      await member.roles.remove(
        tournament.spectator_role_id,
        `Switched to participant for ${tournament.name}`,
      );
    }
  } catch (err) {
    console.warn("[SWITCH] Could not swap roles:", err.message);
  }

  // ── Refresh embeds ─────────────────────────────────────────
  const fresh = getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  const newCount = getParticipantCount(tournament.id);
  return {
    success: true,
    message: `✅ You have switched from spectator to **participant** for **${tournament.name}**! (${newCount}/${tournament.max_players})`,
  };
}

/**
 * Switch an existing participant to spectator.
 */
async function switchToSpectator(guild, tournament, user, member) {
  try {
    updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.SPECTATOR);
  } catch (err) {
    console.error("[SWITCH] DB update failed:", err.message);
    return {
      success: false,
      message: "❌ Failed to switch role. Please try again.",
    };
  }

  // ── Swap roles ─────────────────────────────────────────────
  try {
    if (tournament.spectator_role_id) {
      await member.roles.add(
        tournament.spectator_role_id,
        `Switched to spectator for ${tournament.name}`,
      );
    }
    if (
      tournament.participant_role_id &&
      member.roles.cache.has(tournament.participant_role_id)
    ) {
      await member.roles.remove(
        tournament.participant_role_id,
        `Switched to spectator for ${tournament.name}`,
      );
    }
  } catch (err) {
    console.warn("[SWITCH] Could not swap roles:", err.message);
  }

  // ── Refresh embeds ─────────────────────────────────────────
  const fresh = getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  return {
    success: true,
    message: `👁️ You have switched from participant to **spectator** for **${tournament.name}**.`,
  };
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN REGISTER (bypasses registration-open check)
// ═════════════════════════════════════════════════════════════════

/**
 * Admin registers a user as a participant.
 * Works when tournament is in: created, registration_open, registration_closed.
 * Does NOT work after tournament has started or ended.
 *
 * @param {import('discord.js').Guild}       guild
 * @param {object}                           tournament   DB row
 * @param {import('discord.js').User}        user
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function adminRegisterParticipant(guild, tournament, user, member) {
  // ── Status check (more lenient than normal registration) ───
  const blockedStatuses = [
    TOURNAMENT_STATUS.IN_PROGRESS,
    TOURNAMENT_STATUS.COMPLETED,
    TOURNAMENT_STATUS.CANCELLED,
  ];

  if (blockedStatuses.includes(tournament.status)) {
    return {
      success: false,
      message: '❌ Cannot register players after the tournament has started or ended.',
    };
  }

  // ── Already registered check ───────────────────────────────
  const existing = getParticipant(tournament.id, user.id);

  if (existing) {
    if (existing.role === PARTICIPANT_ROLE.SPECTATOR) {
      // Switch spectator to participant
      const currentCount = getParticipantCount(tournament.id);
      if (currentCount >= tournament.max_players) {
        return {
          success: false,
          message: `❌ Tournament is full (**${tournament.max_players}** max players).`,
        };
      }

      try {
        updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.PARTICIPANT);
      } catch (err) {
        console.error('[ADMIN-REG] Role switch failed:', err.message);
        return { success: false, message: '❌ Failed to switch role. Please try again.' };
      }

      // Swap Discord roles
      try {
        if (tournament.participant_role_id) {
          await member.roles.add(tournament.participant_role_id, `Admin registered for ${tournament.name}`);
        }
        if (tournament.spectator_role_id && member.roles.cache.has(tournament.spectator_role_id)) {
          await member.roles.remove(tournament.spectator_role_id, `Switched to participant for ${tournament.name}`);
        }
      } catch (err) {
        console.warn('[ADMIN-REG] Could not swap roles:', err.message);
      }

      const fresh = getTournamentById(tournament.id);
      await refreshParticipationList(guild, fresh);
      if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
        await refreshRegistrationMessage(guild, fresh);
      }

      const newCount = getParticipantCount(tournament.id);
      return {
        success: true,
        message: `✅ **${user.username}** switched from spectator to **participant**. (${newCount}/${tournament.max_players})`,
      };
    }

    return {
      success: false,
      message: `❌ **${user.username}** is already registered as a participant.`,
    };
  }

  // ── Max players check ──────────────────────────────────────
  const currentCount = getParticipantCount(tournament.id);
  if (currentCount >= tournament.max_players) {
    return {
      success: false,
      message: `❌ Tournament is full (**${tournament.max_players}** max players).`,
    };
  }

  // ── Insert into database ───────────────────────────────────
  try {
    addParticipant({
      tournamentId: tournament.id,
      userId:       user.id,
      username:     user.username,
      displayName:  member.displayName || user.displayName || user.username,
      role:         PARTICIPANT_ROLE.PARTICIPANT,
    });
  } catch (err) {
    console.error('[ADMIN-REG] DB insert failed:', err.message);
    return { success: false, message: '❌ Registration failed. Please try again.' };
  }

  // ── Assign participant role ────────────────────────────────
  try {
    if (tournament.participant_role_id) {
      await member.roles.add(tournament.participant_role_id, `Admin registered for ${tournament.name}`);
    }
  } catch (err) {
    console.warn('[ADMIN-REG] Could not assign role:', err.message);
  }

  // ── Refresh embeds ─────────────────────────────────────────
  const fresh = getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) {
    await refreshRegistrationMessage(guild, fresh);
  }

  const newCount = getParticipantCount(tournament.id);
  return {
    success: true,
    message: `✅ **${user.username}** has been registered for **${tournament.name}** by admin. (${newCount}/${tournament.max_players})`,
  };
}
