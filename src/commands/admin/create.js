import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { isOrganizer } from '../../utils/permissions.js';
import { COLORS } from '../../config.js';
import { getActiveTournamentsByGuild } from '../../database/queries.js';
import { createTournamentInfrastructure } from '../../services/tournamentService.js';

export const data = new SlashCommandBuilder()
  .setName('create')
  .setDescription('Create a new tournament in this server')
  .addStringOption(opt => opt.setName('name').setDescription('Name for the tournament').setRequired(true).setMinLength(2).setMaxLength(50));

export async function execute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
  if (!isOrganizer(interaction.member)) return interaction.reply({ content: '❌ Only server owner or TournamentOrganizer role.', flags: MessageFlags.Ephemeral });

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages])) {
    return interaction.reply({ content: '❌ I need **Manage Channels**, **Manage Roles**, and **Manage Messages** permissions.', flags: MessageFlags.Ephemeral });
  }

  const tournamentName = interaction.options.getString('name', true).trim();
  const existing = await getActiveTournamentsByGuild(interaction.guildId);
  if (existing.some(t => t.name.toLowerCase() === tournamentName.toLowerCase())) {
    return interaction.reply({ content: `❌ An active tournament named **${tournamentName}** already exists.`, flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const tournament = await createTournamentInfrastructure(interaction.guild, interaction.client.user, tournamentName, interaction.user.id);
    const embed = new EmbedBuilder().setTitle('✅ Tournament Created!').setColor(COLORS.SUCCESS)
      .setDescription(`**${tournament.name}** is ready to configure.`)
      .addFields(
        { name: '📂 Category', value: `🏆 ${tournament.name}`, inline: true },
        { name: '📋 Channels', value: '10 channels created', inline: true },
        { name: '🛡️ Admin Panel', value: `<#${tournament.admin_channel_id}>`, inline: true },
        { name: '🆔 ID', value: `\`${tournament.id}\``, inline: true },
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[CREATE]', error);
    await interaction.editReply({ content: `❌ Failed: ${error.message}` });
  }
}
