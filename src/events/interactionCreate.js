// ─── src/events/interactionCreate.js ─────────────────────────────
// Central router: dispatches every interaction to the right handler.

import { MessageFlags } from "discord.js";
import { handleButton } from "../handlers/buttonHandler.js";
import { handleModal } from "../handlers/modalHandler.js";
import { handleAutocomplete } from "../handlers/autocompleteHandler.js";

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client}      client
 */
export async function handleInteraction(interaction, client) {
  try {
    // ── Slash commands ───────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.warn(`[CMD] Unknown command: ${interaction.commandName}`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    // ── Buttons ──────────────────────────────────────────────
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    // ── Modal submits ────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }

    // ── Autocomplete ─────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    // ── Select menus (future) ────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      return;
    }
  } catch (error) {
    console.error("[ERROR] Interaction handler threw:", error);

    const content = "❌ An unexpected error occurred. Please try again.";
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch {
      console.error("[ERROR] Could not send error response to user.");
    }
  }
}
