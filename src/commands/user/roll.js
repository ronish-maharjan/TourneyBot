// ─── src/commands/user/roll.js ───────────────────────────────────
// /roll  — Roll a classic D6 dice. Public result for fairness.

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { COLORS } from '../../config.js';

// Dice face emojis matching 1–6
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Roll a dice (1–6)');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const result = Math.floor(Math.random() * 6) + 1;
  const face   = DICE_FACES[result - 1];

  const embed = new EmbedBuilder()
    .setTitle('🎲 Dice Roll')
    .setColor(COLORS.PRIMARY)
    .setDescription(`# ${face}\n\n**${interaction.user.displayName}** rolled a **${result}**!`)
    .setTimestamp();

  // Public response — everyone can see the result
  await interaction.reply({ embeds: [embed] });
}
