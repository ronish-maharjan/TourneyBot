// ─── src/commands/admin/giverole.js ──────────────────────────────
// /giverole @user @role — Quick assign a role to a user.

import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('giverole')
  .setDescription('Assign a role to a user')
  .addUserOption(opt =>
    opt.setName('user').setDescription('The user to give the role to').setRequired(true),
  )
  .addRoleOption(opt =>
    opt.setName('role').setDescription('The role to assign').setRequired(true),
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
    return interaction.editReply({ content: '❌ Cannot assign bot-managed or integration roles.' });
  }

  if (role.id === interaction.guild.id) {
    return interaction.editReply({ content: '❌ Cannot assign the @everyone role.' });
  }

  const botMember = interaction.guild.members.me;
  if (role.position >= botMember.roles.highest.position) {
    return interaction.editReply({
      content: `❌ I cannot assign **${role.name}** — it is above or equal to my highest role.`,
    });
  }

  if (role.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.editReply({
      content: `❌ You cannot assign **${role.name}** — it is above or equal to your highest role.`,
    });
  }

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);

    if (member.roles.cache.has(role.id)) {
      return interaction.editReply({
        content: `❌ **${targetUser.displayName}** already has the **${role.name}** role.`,
      });
    }

    await member.roles.add(role, `Assigned by ${interaction.user.username}`);

    await interaction.editReply({
      content: `✅ Assigned **${role.name}** to **${targetUser.displayName}**.`,
    });
  } catch (err) {
    console.error('[GIVEROLE]', err);
    await interaction.editReply({ content: `❌ Failed to assign role: ${err.message}` });
  }
}
