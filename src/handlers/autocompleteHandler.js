// ─── src/handlers/autocompleteHandler.js ─────────────────────────

import { getActiveTournamentsByGuild, getTournamentsByGuild } from '../database/queries.js';

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const command = interaction.commandName;

  if (focused.name === 'tournament') {
    const search = focused.value.toLowerCase();
    const tournaments = command === 'tournament-info'
      ? await getTournamentsByGuild(interaction.guildId)
      : await getActiveTournamentsByGuild(interaction.guildId);

    const choices = tournaments
      .filter(t => t.name.toLowerCase().includes(search) || t.id.includes(search))
      .slice(0, 25)
      .map(t => ({
        name: `${t.name} [${formatStatusShort(t.status)}]`,
        value: t.id,
      }));

    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}

function formatStatusShort(status) {
  const map = {
    created: 'Created', registration_open: 'Reg Open', registration_closed: 'Reg Closed',
    in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}
