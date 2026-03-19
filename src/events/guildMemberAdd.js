// ─── src/events/guildMemberAdd.js ────────────────────────────────

import { getAutoroles } from '../database/queries.js';

export async function handleMemberJoin(member) {
  const autoroles = await getAutoroles(member.guild.id);
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
    } catch {}
  }

  if (rolesToAdd.length === 0) return;

  try {
    await member.roles.add(rolesToAdd, 'Auto-role on join');
    console.log(`[AUTOROLE] Assigned [${rolesToAdd.map(r => r.name).join(', ')}] to ${member.user.username}`);
  } catch (err) {
    console.error(`[AUTOROLE] Failed for ${member.user.username}:`, err.message);
  }
}
