import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { getSetting, setSetting } from '../db.js';
import { colors } from '../util.js';

export const name = 'welcome';

const DEFAULTS = {
  welcome_message: 'Welcome {user} to **{server}**! You are member #{count}.',
  leave_message: '**{name}** left the server. We now have {count} members.',
};

export const fillPlaceholders = (text, vars) => text.replace(/\{(user|name|server|count)\}/g, (_, k) => vars[k]);

async function announce(member, key) {
  const channel = member.guild.channels.cache.get(getSetting(member.guild.id, 'welcome_channel'));
  const text = getSetting(member.guild.id, key) ?? DEFAULTS[key];
  if (!channel?.isTextBased() || text === 'off') return;
  const description = fillPlaceholders(text, {
    user: `${member}`, name: member.displayName, server: member.guild.name, count: member.guild.memberCount,
  });
  await channel.send({
    embeds: [{
      description,
      color: key === 'welcome_message' ? colors.ok : colors.warn,
      thumbnail: { url: member.displayAvatarURL({ size: 128 }) },
    }],
    allowedMentions: { users: [member.id] },
  });
}

export const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Welcome and leave messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('message').setDescription('Set the join or leave message')
      .addStringOption(o => o.setName('type').setDescription('Which message').setRequired(true)
        .addChoices({ name: 'Join', value: 'welcome_message' }, { name: 'Leave', value: 'leave_message' }))
      .addStringOption(o => o.setName('text').setDescription('Use {user} {name} {server} {count}. Type off to disable, default to reset.')
        .setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('test').setDescription('Preview the join and leave messages in the welcome channel')),
];

export async function onCommand(i) {
  if (!getSetting(i.guildId, 'welcome_channel')) {
    return i.reply({ content: 'Set a welcome channel first with `/setup channel`.', flags: MessageFlags.Ephemeral });
  }
  if (i.options.getSubcommand() === 'test') {
    await announce(i.member, 'welcome_message');
    await announce(i.member, 'leave_message');
    return i.reply({ content: 'Test messages sent to the welcome channel.', flags: MessageFlags.Ephemeral });
  }
  const key = i.options.getString('type');
  const text = i.options.getString('text');
  setSetting(i.guildId, key, text === 'default' ? null : text);
  await i.reply({ content: text === 'off' ? 'Message disabled.' : 'Message saved. Try it with `/welcome test`.', flags: MessageFlags.Ephemeral });
}

export const events = {
  async guildMemberAdd(member) {
    if (member.user.bot) return;
    const role = member.guild.roles.cache.get(getSetting(member.guild.id, 'autorole'));
    if (role?.editable) await member.roles.add(role, 'Autorole on join');
    await announce(member, 'welcome_message');
  },
  async guildMemberRemove(member) {
    if (member.user.bot) return;
    await announce(member, 'leave_message');
  },
};
