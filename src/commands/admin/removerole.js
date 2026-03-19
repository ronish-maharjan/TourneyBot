import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('removerole')
  .setDescription('Remove a role from a user')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true));

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guild) return interaction.editReply({ content: '❌ Server only.' });
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.editReply({ content: '❌ Need **Manage Roles**.' });

  const user = interaction.options.getUser('user', true);
  const role = interaction.options.getRole('role', true);
  if (role.managed || role.id === interaction.guild.id) return interaction.editReply({ content: '❌ Invalid role.' });
  if (role.position >= interaction.guild.members.me.roles.highest.position) return interaction.editReply({ content: `❌ **${role.name}** is above my role.` });
  if (role.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) return interaction.editReply({ content: `❌ **${role.name}** is above your role.` });

  try {
    const member = await interaction.guild.members.fetch(user.id);
    if (!member.roles.cache.has(role.id)) return interaction.editReply({ content: `❌ **${user.displayName}** doesn't have **${role.name}**.` });
    await member.roles.remove(role, `Removed by ${interaction.user.username}`);
    await interaction.editReply({ content: `✅ Removed **${role.name}** from **${user.displayName}**.` });
  } catch (err) { await interaction.editReply({ content: `❌ Failed: ${err.message}` }); }
}
