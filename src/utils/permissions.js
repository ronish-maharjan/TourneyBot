// ─── src/utils/permissions.js ────────────────────────────────────

import { ROLE_NAMES } from '../config.js';

/**
 * Is the member allowed to run organiser-level commands?
 * True if: guild owner OR has TournamentOrganizer role OR has Administrator permission.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function isOrganizer(member) {
  if (!member || !member.guild) return false;

  // Guild owner always has access
  if (member.id === member.guild.ownerId) return true;

  // Administrator permission
  if (member.permissions.has('Administrator')) return true;

  // Check for TournamentOrganizer role by name
  const role = member.guild.roles.cache.find(r => r.name === ROLE_NAMES.ORGANIZER);
  return role ? member.roles.cache.has(role.id) : false;
}

/**
 * Does the member have a specific role (by Discord role ID)?
 */
export function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles.cache.has(roleId);
}

/**
 * Is the member the server owner?
 */
export function isGuildOwner(member) {
  return member?.id === member?.guild?.ownerId;
}
