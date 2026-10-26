import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { db } from '../db.js';
import { card } from '../ui.js';

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

// Rebuilt from the database on every pick, which also clears the member's selection in the menu.
function menuMessage(menu, guild) {
  const roles = JSON.parse(menu.role_ids).map(id => guild.roles.cache.get(id)).filter(Boolean);
  return card({
    banner: 'roles',
    title: menu.title,
    body: menu.description,
    blocks: [`**Available roles**\n${roles.join('  ') || 'none'}`],
    footer: menu.single ? 'Pick one role. Picking another one replaces it.' : 'Pick any roles. Pick a role you already have to remove it.',
    rows: roles.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`roles:toggle:${menu.id}`)
      .setPlaceholder(menu.single ? 'Pick one role' : 'Pick roles')
      .setMinValues(1)
      .setMaxValues(menu.single ? 1 : roles.length)
      .addOptions(roles.map(r => ({ label: r.name, value: r.id }))))] : [],
  });
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
    description: i.options.getString('description') ?? 'Choose the roles that fit you.',
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

export async function onComponent(i, action, [id]) {
  if (action === 'pick') {
    const draft = drafts.get(`${i.guildId}:${i.user.id}`);
    if (!draft) return i.update({ content: 'This menu draft expired. Run `/rolemenu create` again.', components: [] });
    const problems = [...i.roles.values()].map(r => [r, roleProblem(r, i.member)]).filter(([, p]) => p);
    if (problems.length) {
      return i.update({ content: `Can't use these roles:\n${problems.map(([r, p]) => `- ${r} ${p}`).join('\n')}\nPick again.` });
    }
    drafts.delete(`${i.guildId}:${i.user.id}`);
    const menu = db.prepare('INSERT INTO role_menus (guild_id, title, description, single, role_ids) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(i.guildId, draft.title, draft.description, draft.single ? 1 : 0, JSON.stringify([...i.roles.keys()]));
    const channel = i.guild.channels.cache.get(draft.channelId);
    await channel.send(menuMessage(menu, i.guild));
    return i.update({ content: `Role menu posted in ${channel}.`, components: [] });
  }

  if (action === 'toggle') {
    const menu = db.prepare('SELECT * FROM role_menus WHERE id = ? AND guild_id = ?').get(Number(id), i.guildId);
    if (!menu) return i.reply(ephemeral('This role menu is outdated. Ask staff to post it again with `/rolemenu create`.'));
    const menuRoles = JSON.parse(menu.role_ids);
    const added = [], removed = [], skipped = [];

    for (const roleId of i.values.filter(v => menuRoles.includes(v))) {
      const role = i.guild.roles.cache.get(roleId);
      if (!role || roleProblem(role)) { skipped.push(role?.name ?? 'deleted role'); continue; }
      if (i.member.roles.cache.has(roleId)) {
        await i.member.roles.remove(role, 'Role menu');
        removed.push(role);
      } else {
        await i.member.roles.add(role, 'Role menu');
        added.push(role);
      }
    }
    if (menu.single && added.length) {
      for (const roleId of menuRoles) {
        if (roleId === added[0].id || !i.member.roles.cache.has(roleId)) continue;
        const role = i.guild.roles.cache.get(roleId);
        if (role && !roleProblem(role)) {
          await i.member.roles.remove(role, 'Role menu (single choice)');
          removed.push(role);
        }
      }
    }

    await i.update(menuMessage(menu, i.guild));
    const lines = [
      added.length && `**Added** ${added.join(', ')}`,
      removed.length && `**Removed** ${removed.join(', ')}`,
      skipped.length && `**Not available** ${skipped.join(', ')}`,
    ].filter(Boolean);
    return i.followUp(card({ body: `### Your roles were updated\n${lines.join('\n') || 'No changes.'}`, ephemeral: true }));
  }
}
