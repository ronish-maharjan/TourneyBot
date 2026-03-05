// ─── src/utils/permissions.js ────────────────────────────────────
// Centralised permission checks for tournament admin operations.

import { ROLE_NAMES } from "../config.js";

/**
 * Is the member allowed to run organiser-level commands?
 * True if the member is the guild owner OR has the TournamentOrganizer role.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function isOrganizer(member) {
  if (!member || !member.guild) return false;

  // Guild owner always has full access
  if (member.id === member.guild.ownerId) return true;

  // Check for TournamentOrganizer role by name
  const role = member.guild.roles.cache.find(
    (r) => r.name === ROLE_NAMES.ORGANIZER,
  );

  return role ? member.roles.cache.has(role.id) : false;
}

/**
 * Does the member have a specific role (by Discord role ID)?
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} roleId
 * @returns {boolean}
 */
export function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles.cache.has(roleId);
}

/**
 * Quick check: is the member the server owner?
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function isGuildOwner(member) {
  return member?.id === member?.guild?.ownerId;
}
