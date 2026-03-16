// ─── src/events/guildMemberAdd.js ────────────────────────────────
// Assigns auto-roles when a new member joins the server.

import { getAutoroles } from '../database/queries.js';

/**
 * @param {import('discord.js').GuildMember} member
 */
export async function handleMemberJoin(member) {
  const autoroles = getAutoroles(member.guild.id);
  if (autoroles.length === 0) return;

  const rolesToAdd = [];

  for (const ar of autoroles) {
    try {
      const role = member.guild.roles.cache.get(ar.role_id);
      if (!role) continue;

      const botMember = member.guild.members.me;
      if (role.position >= botMember.roles.highest.position) continue;

      if (member.roles.cache.has(role.id)) continue;

      rolesToAdd.push(role);
    } catch {
      // Role may have been deleted
    }
  }

  if (rolesToAdd.length === 0) return;

  try {
    await member.roles.add(rolesToAdd, 'Auto-role on join');
    const roleNames = rolesToAdd.map(r => r.name).join(', ');
    console.log(`[AUTOROLE] Assigned [${roleNames}] to ${member.user.username} in ${member.guild.name}`);
  } catch (err) {
    console.error(`[AUTOROLE] Failed for ${member.user.username}:`, err.message);
  }
}
