import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { colors } from '../util.js';

export const name = 'roles';

const { Administrator, ManageGuild, ManageRoles, ManageChannels, ManageMessages, ManageWebhooks, BanMembers, KickMembers, ModerateMembers, MentionEveryone } = PermissionFlagsBits;
const STAFF_PERMS = [Administrator, ManageGuild, ManageRoles, ManageChannels, ManageMessages, ManageWebhooks, BanMembers, KickMembers, ModerateMembers, MentionEveryone];

// Draft menus between the slash command and the role picker, keyed by `${guildId}:${userId}`.
const drafts = new Map();

// Self-assign roles must never grant staff powers, even if an admin picks one by mistake.
export function roleProblem(role, member) {
  if (role.id === role.guild.id) return 'is @everyone';
  if (role.managed) return 'is managed by an integration';
  if (role.permissions.any(STAFF_PERMS)) return 'has staff permissions';
  if (!role.editable) return 'is above my highest role';
  if (member && member.id !== role.guild.ownerId && role.position >= member.roles.highest.position) return 'is not below your highest role';
  return null;
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  new SlashCommandBuilder().setName('rolemenu').setDescription('Self-assign role menus')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('create').setDescription('Post a role menu')
      .addStringOption(o => o.setName('title').setDescription('Menu title').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Text shown above the menu').setMaxLength(1000))
      .addBooleanOption(o => o.setName('single').setDescription('Members can hold only one role from this menu'))
      .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText))),
];

export async function onCommand(i) {
  drafts.set(`${i.guildId}:${i.user.id}`, {
    title: i.options.getString('title'),
    description: i.options.getString('description') ?? 'Pick roles below. Pick a role you already have to remove it.',
    single: i.options.getBoolean('single') ?? false,
    channelId: (i.options.getChannel('channel') ?? i.channel).id,
  });
  await i.reply({
    content: 'Pick the roles for this menu (up to 25).',
    flags: MessageFlags.Ephemeral,
    components: [new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('roles:pick').setPlaceholder('Choose roles').setMinValues(1).setMaxValues(25))],
  });
}

export async function onComponent(i, action) {
  if (action === 'pick') {
    const draft = drafts.get(`${i.guildId}:${i.user.id}`);
    if (!draft) return i.update({ content: 'This menu draft expired. Run `/rolemenu create` again.', components: [] });
    const problems = [...i.roles.values()].map(r => [r, roleProblem(r, i.member)]).filter(([, p]) => p);
    if (problems.length) {
      return i.update({ content: `Can't use these roles:\n${problems.map(([r, p]) => `- ${r} ${p}`).join('\n')}\nPick again.` });
    }
    drafts.delete(`${i.guildId}:${i.user.id}`);
    const channel = i.guild.channels.cache.get(draft.channelId);
    await channel.send({
      embeds: [{ title: draft.title, description: draft.description, color: colors.brand }],
      components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`roles:toggle:${draft.single ? 1 : 0}`)
        .setPlaceholder(draft.single ? 'Pick one role' : 'Pick roles')
        .setMinValues(1)
        .setMaxValues(draft.single ? 1 : i.roles.size)
        .addOptions(i.roles.map(r => ({ label: r.name, value: r.id }))))],
    });
    return i.update({ content: `Role menu posted in ${channel}.`, components: [] });
  }

  if (action === 'toggle') {
    const single = i.customId.endsWith(':1');
    const menuRoles = i.component.options.map(o => o.value);
    const added = [], removed = [], skipped = [];

    for (const id of i.values) {
      const role = i.guild.roles.cache.get(id);
      if (!role || roleProblem(role)) { skipped.push(role?.name ?? 'deleted role'); continue; }
      if (i.member.roles.cache.has(id)) {
        await i.member.roles.remove(role, 'Role menu');
        removed.push(role);
      } else {
        await i.member.roles.add(role, 'Role menu');
        added.push(role);
      }
    }
    if (single && added.length) {
      for (const id of menuRoles) {
        if (id === added[0].id || !i.member.roles.cache.has(id)) continue;
        const role = i.guild.roles.cache.get(id);
        if (role && !roleProblem(role)) {
          await i.member.roles.remove(role, 'Role menu (single choice)');
          removed.push(role);
        }
      }
    }

    // Re-send the same components so the member's selection resets.
    await i.update({ components: i.message.components });
    const lines = [
      added.length && `Added: ${added.join(', ')}`,
      removed.length && `Removed: ${removed.join(', ')}`,
      skipped.length && `Not available: ${skipped.join(', ')}`,
    ].filter(Boolean);
    return i.followUp(ephemeral(lines.join('\n') || 'No changes.'));
  }
}
