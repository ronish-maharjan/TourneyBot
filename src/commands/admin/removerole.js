// ─── src/commands/admin/removerole.js ────────────────────────────
// /removerole @user @role — Quick remove a role from a user.

import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('removerole')
  .setDescription('Remove a role from a user')
  .addUserOption(opt =>
    opt.setName('user').setDescription('The user to remove the role from').setRequired(true),
  )
  .addRoleOption(opt =>
    opt.setName('role').setDescription('The role to remove').setRequired(true),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  // Defer FIRST to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    return interaction.editReply({ content: '❌ This command can only be used inside a server.' });
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply({ content: '❌ You need **Manage Roles** permission.' });
  }

  const targetUser = interaction.options.getUser('user', true);
  const role       = interaction.options.getRole('role', true);

  if (role.managed) {
    return interaction.editReply({ content: '❌ Cannot remove bot-managed or integration roles.' });
  }

  if (role.id === interaction.guild.id) {
    return interaction.editReply({ content: '❌ Cannot remove the @everyone role.' });
  }

  const botMember = interaction.guild.members.me;
  if (role.position >= botMember.roles.highest.position) {
    return interaction.editReply({
      content: `❌ I cannot remove **${role.name}** — it is above or equal to my highest role.`,
    });
  }

  if (role.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.editReply({
      content: `❌ You cannot remove **${role.name}** — it is above or equal to your highest role.`,
    });
  }

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);

    if (!member.roles.cache.has(role.id)) {
      return interaction.editReply({
        content: `❌ **${targetUser.displayName}** doesn't have the **${role.name}** role.`,
      });
    }

    await member.roles.remove(role, `Removed by ${interaction.user.username}`);

    await interaction.editReply({
      content: `✅ Removed **${role.name}** from **${targetUser.displayName}**.`,
    });
  } catch (err) {
    console.error('[REMOVEROLE]', err);
    await interaction.editReply({ content: `❌ Failed to remove role: ${err.message}` });
  }
}
