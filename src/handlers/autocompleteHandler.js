// ─── src/handlers/autocompleteHandler.js ─────────────────────────
// Provides autocomplete suggestions for tournament-related options.

import {
  getActiveTournamentsByGuild,
  getTournamentsByGuild,
} from "../database/queries.js";

/**
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const command = interaction.commandName;

  if (focused.name === "tournament") {
    const search = focused.value.toLowerCase();

    // /tournament-info shows ALL tournaments (including completed)
    // /match shows only active tournaments
    const tournaments =
      command === "tournament-info"
        ? getTournamentsByGuild(interaction.guildId)
        : getActiveTournamentsByGuild(interaction.guildId);

    const choices = tournaments
      .filter(
        (t) => t.name.toLowerCase().includes(search) || t.id.includes(search),
      )
      .slice(0, 25)
      .map((t) => ({
        name: `${t.name} [${formatStatusShort(t.status)}]`,
        value: t.id,
      }));

    await interaction.respond(choices);
    return;
  }

  // Fallback
  await interaction.respond([]);
}

/**
 * Short status labels for autocomplete display.
 * @param {string} status
 * @returns {string}
 */
function formatStatusShort(status) {
  const map = {
    created: "Created",
    registration_open: "Reg Open",
    registration_closed: "Reg Closed",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}
