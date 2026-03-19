// ─── src/services/registrationService.js ─────────────────────────

import {
  getTournamentById,
  getParticipant,
  addParticipant,
  removeParticipant,
  updateParticipantRole,
  getParticipantCount,
} from '../database/queries.js';
import {
  TOURNAMENT_STATUS,
  PARTICIPANT_ROLE,
} from '../config.js';
import {
  refreshParticipationList,
  refreshRegistrationMessage,
} from './tournamentService.js';
import { acquireLock, releaseLock } from './lockService.js';

// ═════════════════════════════════════════════════════════════════
//  REGISTER
// ═════════════════════════════════════════════════════════════════

export async function registerParticipant(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) return { success: false, message: '⏳ Your registration is being processed.' };

  try {
    const fresh = await getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) return { success: false, message: '❌ Registration is not currently open.' };

    const existing = await getParticipant(tournament.id, user.id);
    if (existing) {
      if (existing.role === PARTICIPANT_ROLE.SPECTATOR) return await switchToParticipant(guild, fresh, user, member);
      return { success: false, message: '❌ You are already registered as a participant.' };
    }

    const currentCount = await getParticipantCount(tournament.id);
    if (currentCount >= fresh.max_players) return { success: false, message: `❌ Tournament is full (**${fresh.max_players}** max).` };

    try {
      await addParticipant({ tournamentId: tournament.id, userId: user.id, username: user.username, displayName: member.displayName || user.displayName || user.username, role: PARTICIPANT_ROLE.PARTICIPANT });
    } catch (err) { return { success: false, message: '❌ Registration failed.' }; }

    try {
      if (fresh.participant_role_id) await member.roles.add(fresh.participant_role_id);
      if (fresh.spectator_role_id && member.roles.cache.has(fresh.spectator_role_id)) await member.roles.remove(fresh.spectator_role_id);
    } catch {}

    const updated = await getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);
    await refreshRegistrationMessage(guild, updated);

    const newCount = await getParticipantCount(tournament.id);
    return { success: true, message: `✅ You have been registered for **${fresh.name}**! (${newCount}/${fresh.max_players})` };
  } finally { releaseLock(lockKey); }
}

// ═════════════════════════════════════════════════════════════════
//  UNREGISTER
// ═════════════════════════════════════════════════════════════════

export async function unregisterParticipant(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) return { success: false, message: '⏳ Your request is being processed.' };

  try {
    const fresh = await getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) return { success: false, message: '❌ Registration is not currently open.' };

    const existing = await getParticipant(tournament.id, user.id);
    if (!existing) return { success: false, message: '❌ You are not registered.' };

    try { await removeParticipant(tournament.id, user.id); } catch { return { success: false, message: '❌ Failed to unregister.' }; }

    try {
      if (fresh.participant_role_id && member.roles.cache.has(fresh.participant_role_id)) await member.roles.remove(fresh.participant_role_id);
      if (fresh.spectator_role_id && member.roles.cache.has(fresh.spectator_role_id)) await member.roles.remove(fresh.spectator_role_id);
    } catch {}

    const updated = await getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);
    await refreshRegistrationMessage(guild, updated);

    return { success: true, message: `✅ You have been unregistered from **${fresh.name}**.` };
  } finally { releaseLock(lockKey); }
}

// ═════════════════════════════════════════════════════════════════
//  SPECTATE
// ═════════════════════════════════════════════════════════════════

export async function registerSpectator(guild, tournament, user, member) {
  const lockKey = `reg_${tournament.id}_${user.id}`;
  if (!acquireLock(lockKey)) return { success: false, message: '⏳ Your request is being processed.' };

  try {
    const fresh = await getTournamentById(tournament.id);
    if (fresh.status !== TOURNAMENT_STATUS.REGISTRATION_OPEN) return { success: false, message: '❌ Registration is not currently open.' };

    const existing = await getParticipant(tournament.id, user.id);
    if (existing) {
      if (existing.role === PARTICIPANT_ROLE.SPECTATOR) return { success: false, message: '❌ You are already a spectator.' };
      return await switchToSpectator(guild, fresh, user, member);
    }

    try {
      await addParticipant({ tournamentId: tournament.id, userId: user.id, username: user.username, displayName: member.displayName || user.displayName || user.username, role: PARTICIPANT_ROLE.SPECTATOR });
    } catch { return { success: false, message: '❌ Failed to register as spectator.' }; }

    try { if (fresh.spectator_role_id) await member.roles.add(fresh.spectator_role_id); } catch {}

    const updated = await getTournamentById(tournament.id);
    await refreshParticipationList(guild, updated);

    return { success: true, message: `👁️ You are now a spectator for **${fresh.name}**.` };
  } finally { releaseLock(lockKey); }
}

// ═════════════════════════════════════════════════════════════════
//  ADMIN REGISTER
// ═════════════════════════════════════════════════════════════════

export async function adminRegisterParticipant(guild, tournament, user, member) {
  const blockedStatuses = [TOURNAMENT_STATUS.IN_PROGRESS, TOURNAMENT_STATUS.COMPLETED, TOURNAMENT_STATUS.CANCELLED];
  if (blockedStatuses.includes(tournament.status)) return { success: false, message: '❌ Cannot register after tournament has started or ended.' };

  const existing = await getParticipant(tournament.id, user.id);
  if (existing) {
    if (existing.role === PARTICIPANT_ROLE.SPECTATOR) {
      const currentCount = await getParticipantCount(tournament.id);
      if (currentCount >= tournament.max_players) return { success: false, message: `❌ Tournament is full (**${tournament.max_players}** max).` };

      try { await updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.PARTICIPANT); } catch { return { success: false, message: '❌ Failed to switch role.' }; }

      try {
        if (tournament.participant_role_id) await member.roles.add(tournament.participant_role_id);
        if (tournament.spectator_role_id && member.roles.cache.has(tournament.spectator_role_id)) await member.roles.remove(tournament.spectator_role_id);
      } catch {}

      const fresh = await getTournamentById(tournament.id);
      await refreshParticipationList(guild, fresh);
      if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) await refreshRegistrationMessage(guild, fresh);

      const newCount = await getParticipantCount(tournament.id);
      return { success: true, message: `✅ **${user.username}** switched to **participant**. (${newCount}/${tournament.max_players})` };
    }
    return { success: false, message: `❌ **${user.username}** is already registered.` };
  }

  const currentCount = await getParticipantCount(tournament.id);
  if (currentCount >= tournament.max_players) return { success: false, message: `❌ Tournament is full (**${tournament.max_players}** max).` };

  try {
    await addParticipant({ tournamentId: tournament.id, userId: user.id, username: user.username, displayName: member.displayName || user.displayName || user.username, role: PARTICIPANT_ROLE.PARTICIPANT });
  } catch { return { success: false, message: '❌ Registration failed.' }; }

  try { if (tournament.participant_role_id) await member.roles.add(tournament.participant_role_id); } catch {}

  const fresh = await getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  if (fresh.status === TOURNAMENT_STATUS.REGISTRATION_OPEN) await refreshRegistrationMessage(guild, fresh);

  const newCount = await getParticipantCount(tournament.id);
  return { success: true, message: `✅ **${user.username}** registered by admin. (${newCount}/${tournament.max_players})` };
}

// ═════════════════════════════════════════════════════════════════
//  ROLE SWITCHING
// ═════════════════════════════════════════════════════════════════

async function switchToParticipant(guild, tournament, user, member) {
  const currentCount = await getParticipantCount(tournament.id);
  if (currentCount >= tournament.max_players) return { success: false, message: `❌ Tournament is full (**${tournament.max_players}** max).` };

  try { await updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.PARTICIPANT); } catch { return { success: false, message: '❌ Failed to switch role.' }; }

  try {
    if (tournament.participant_role_id) await member.roles.add(tournament.participant_role_id);
    if (tournament.spectator_role_id && member.roles.cache.has(tournament.spectator_role_id)) await member.roles.remove(tournament.spectator_role_id);
  } catch {}

  const fresh = await getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  const newCount = await getParticipantCount(tournament.id);
  return { success: true, message: `✅ Switched to **participant** for **${tournament.name}**! (${newCount}/${tournament.max_players})` };
}

async function switchToSpectator(guild, tournament, user, member) {
  try { await updateParticipantRole(tournament.id, user.id, PARTICIPANT_ROLE.SPECTATOR); } catch { return { success: false, message: '❌ Failed to switch role.' }; }

  try {
    if (tournament.spectator_role_id) await member.roles.add(tournament.spectator_role_id);
    if (tournament.participant_role_id && member.roles.cache.has(tournament.participant_role_id)) await member.roles.remove(tournament.participant_role_id);
  } catch {}

  const fresh = await getTournamentById(tournament.id);
  await refreshParticipationList(guild, fresh);
  await refreshRegistrationMessage(guild, fresh);

  return { success: true, message: `👁️ Switched to **spectator** for **${tournament.name}**.` };
}
