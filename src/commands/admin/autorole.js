import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { addAutorole, removeAutorole, getAutoroles, clearAutoroles } from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('autorole')
  .setDescription('Manage auto-assigned roles for new members')
  .addSubcommand(s => s.setName('add').setDescription('Add auto-role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove auto-role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('Show auto-roles'))
  .addSubcommand(s => s.setName('clear').setDescription('Clear all auto-roles'));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub !== 'list' && !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply({ content: '❌ Need **Manage Roles** permission.' });
  }

  try {
    switch (sub) {
      case 'add': {
        const role = interaction.options.getRole('role', true);
        if (role.managed || role.id === interaction.guild.id) return interaction.editReply({ content: '❌ Invalid role.' });
        if (role.position >= interaction.guild.members.me.roles.highest.position) return interaction.editReply({ content: `❌ **${role.name}** is above my highest role.` });

        const existing = await getAutoroles(interaction.guildId);
        if (existing.length >= 10) return interaction.editReply({ content: '❌ Max 10 auto-roles.' });
        if (existing.some(r => r.role_id === role.id)) return interaction.editReply({ content: `❌ **${role.name}** already added.` });

        await addAutorole(interaction.guildId, role.id);
        const total = (await getAutoroles(interaction.guildId)).length;
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅ Auto-Role Added').setColor(COLORS.SUCCESS).setDescription(`**${role.name}** will be auto-assigned.\n📋 Total: **${total}**`).setTimestamp()] });
      }
      case 'remove': {
        const role = interaction.options.getRole('role', true);
        const existing = await getAutoroles(interaction.guildId);
        if (!existing.some(r => r.role_id === role.id)) return interaction.editReply({ content: `❌ **${role.name}** not in list.` });
        await removeAutorole(interaction.guildId, role.id);
        const total = (await getAutoroles(interaction.guildId)).length;
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅ Auto-Role Removed').setColor(COLORS.SUCCESS).setDescription(`**${role.name}** removed.\n📋 Remaining: **${total}**`).setTimestamp()] });
      }
      case 'list': {
        const autoroles = await getAutoroles(interaction.guildId);
        const embed = new EmbedBuilder().setTitle('📋 Auto-Roles').setColor(COLORS.INFO).setTimestamp();
        if (autoroles.length === 0) { embed.setDescription('📭 None configured.\n_Use `/autorole add @role`_'); }
        else {
          const lines = autoroles.map((ar, i) => { const r = interaction.guild.roles.cache.get(ar.role_id); return r ? `**${i+1}.** <@&${ar.role_id}>` : `**${i+1}.** ~~Unknown~~ (\`${ar.role_id}\`)`; });
          embed.setDescription(`Auto-assigned on join:\n\n${lines.join('\n')}`);
        }
        embed.setFooter({ text: `${autoroles.length}/10 configured` });
        return interaction.editReply({ embeds: [embed] });
      }
      case 'clear': {
        const existing = await getAutoroles(interaction.guildId);
        if (existing.length === 0) return interaction.editReply({ content: '📭 Nothing to clear.' });
        await clearAutoroles(interaction.guildId);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅ Auto-Roles Cleared').setColor(COLORS.SUCCESS).setDescription(`Removed **${existing.length}** auto-role(s).`).setTimestamp()] });
      }
    }
  } catch (err) {
    console.error('[AUTOROLE]', err);
    await interaction.editReply({ content: `❌ Error: ${err.message}` });
  }
}
