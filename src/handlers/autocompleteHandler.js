// ─── src/handlers/autocompleteHandler.js ─────────────────────────
// Provides autocomplete suggestions for tournament-related options.

import { getActiveTournamentsByGuild } from "../database/queries.js";

/**
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  // ── "tournament" option (used by /tournament-info, /match) ─
  if (focused.name === "tournament") {
    const search = focused.value.toLowerCase();
    const tournaments = getActiveTournamentsByGuild(interaction.guildId);

    const choices = tournaments
      .filter(
        (t) => t.name.toLowerCase().includes(search) || t.id.includes(search),
      )
      .slice(0, 25)
      .map((t) => ({
        name: `${t.name} [${t.status.replaceAll("_", " ")}]`,
        value: t.id,
      }));

    await interaction.respond(choices);
    return;
  }

  // ── Fallback: return empty list ────────────────────────────
  await interaction.respond([]);
}
