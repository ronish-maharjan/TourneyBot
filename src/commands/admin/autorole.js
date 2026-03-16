// ─── src/commands/admin/autorole.js ──────────────────────────────
// /autorole add|remove|list|clear — Manage auto-assigned roles on member join.

import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from 'discord.js';
import {
    addAutorole,
    removeAutorole,
    getAutoroles,
    clearAutoroles,
} from '../../database/queries.js';
import { COLORS } from '../../config.js';

export const data = new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Manage auto-assigned roles for new members')
    .addSubcommand(sub =>
        sub
        .setName('add')
        .setDescription('Add a role to auto-assign on join')
        .addRoleOption(opt =>
            opt.setName('role').setDescription('Role to auto-assign').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
        sub
        .setName('remove')
        .setDescription('Remove a role from auto-assign list')
        .addRoleOption(opt =>
            opt.setName('role').setDescription('Role to remove').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
        sub.setName('list').setDescription('Show all auto-assigned roles'),
    )
    .addSubcommand(sub =>
        sub.setName('clear').setDescription('Remove all auto-assigned roles'),
    );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({
            content: '❌ This command can only be used inside a server.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // Defer FIRST — before any checks
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    // Permission check (using editReply since we already deferred)
    if (subcommand !== 'list') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.editReply({
                content: '❌ You need **Manage Roles** permission to use this command.',
            });
        }
    }

    try {
        switch (subcommand) {
            case 'add':    return await handleAdd(interaction);
            case 'remove': return await handleRemove(interaction);
            case 'list':   return await handleList(interaction);
            case 'clear':  return await handleClear(interaction);
        }
    } catch (err) {
        console.error('[AUTOROLE]', err);
        await interaction.editReply({ content: `❌ An error occurred: ${err.message}` });
    }
}

// ── Add ──────────────────────────────────────────────────────────

async function handleAdd(interaction) {
    const role = interaction.options.getRole('role', true);

    if (role.managed) {
        return interaction.editReply({ content: '❌ Cannot auto-assign bot-managed or integration roles.' });
    }

    if (role.id === interaction.guild.id) {
        return interaction.editReply({ content: '❌ Cannot auto-assign the @everyone role.' });
    }

    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
            content: `❌ I cannot assign **${role.name}** because it is above or equal to my highest role.\nMove my role higher in Server Settings → Roles.`,
        });
    }

    const existing = getAutoroles(interaction.guildId);

    if (existing.length >= 10) {
        return interaction.editReply({ content: '❌ Maximum of **10** auto-roles allowed. Remove one first.' });
    }

    if (existing.some(r => r.role_id === role.id)) {
        return interaction.editReply({ content: `❌ **${role.name}** is already in the auto-role list.` });
    }

    addAutorole(interaction.guildId, role.id);
    const totalCount = getAutoroles(interaction.guildId).length;

    const embed = new EmbedBuilder()
        .setTitle('✅ Auto-Role Added')
        .setColor(COLORS.SUCCESS)
        .setDescription(
            `**${role.name}** will now be automatically assigned to new members.\n\n` +
            `📋 Total auto-roles: **${totalCount}**`,
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

// ── Remove ───────────────────────────────────────────────────────

async function handleRemove(interaction) {
    const role = interaction.options.getRole('role', true);

    const existing = getAutoroles(interaction.guildId);
    if (!existing.some(r => r.role_id === role.id)) {
        return interaction.editReply({ content: `❌ **${role.name}** is not in the auto-role list.` });
    }

    removeAutorole(interaction.guildId, role.id);
    const totalCount = getAutoroles(interaction.guildId).length;

    const embed = new EmbedBuilder()
        .setTitle('✅ Auto-Role Removed')
        .setColor(COLORS.SUCCESS)
        .setDescription(
            `**${role.name}** will no longer be auto-assigned to new members.\n\n` +
            `📋 Remaining auto-roles: **${totalCount}**`,
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

// ── List ─────────────────────────────────────────────────────────

async function handleList(interaction) {
    const autoroles = getAutoroles(interaction.guildId);

    const embed = new EmbedBuilder()
        .setTitle('📋 Auto-Roles')
        .setColor(COLORS.INFO)
        .setTimestamp();

    if (autoroles.length === 0) {
        embed.setDescription(
            '📭 No auto-roles configured.\n\n' +
            '_Use `/autorole add @role` to add roles that are automatically assigned to new members._',
        );
    } else {
        const lines = [];
        for (let i = 0; i < autoroles.length; i++) {
            const roleId = autoroles[i].role_id;
            const role   = interaction.guild.roles.cache.get(roleId);

            if (role) {
                lines.push(`**${i + 1}.** <@&${roleId}> (${role.name})`);
            } else {
                lines.push(`**${i + 1}.** ~~Unknown Role~~ (\`${roleId}\`) — _role deleted?_`);
            }
        }

        embed.setDescription(
            `These roles are automatically assigned to every new member:\n\n` +
            lines.join('\n'),
        );
    }

    embed.setFooter({ text: `${autoroles.length}/10 auto-roles configured` });

    await interaction.editReply({ embeds: [embed] });
}

// ── Clear ────────────────────────────────────────────────────────

async function handleClear(interaction) {
    const existing = getAutoroles(interaction.guildId);

    if (existing.length === 0) {
        return interaction.editReply({ content: '📭 No auto-roles to clear.' });
    }

    clearAutoroles(interaction.guildId);

    const embed = new EmbedBuilder()
        .setTitle('✅ Auto-Roles Cleared')
        .setColor(COLORS.SUCCESS)
        .setDescription(`Removed **${existing.length}** auto-role(s).\nNew members will not receive any automatic roles.`)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
