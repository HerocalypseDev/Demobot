import { SlashCommandBuilder, InteractionContextType, ChannelType } from 'discord.js';
import { db } from '../db.js';
import { colors, isStaff } from '../util.js';

export const name = 'info';

const ts = ms => `<t:${Math.floor(ms / 1000)}:D> (<t:${Math.floor(ms / 1000)}:R>)`;
const userOpt = o => o.setName('user').setDescription('Member (default: you)');

export const commands = [
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server').setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show information about a member').setContexts(InteractionContextType.Guild).addUserOption(userOpt),
  new SlashCommandBuilder().setName('avatar').setDescription('Show a member\'s avatar').setContexts(InteractionContextType.Guild).addUserOption(userOpt),
];

export async function onCommand(i) {
  if (i.commandName === 'serverinfo') {
    const g = i.guild;
    const count = type => g.channels.cache.filter(c => c.type === type).size;
    return i.reply({
      embeds: [{
        title: g.name,
        color: colors.brand,
        thumbnail: g.iconURL() ? { url: g.iconURL({ size: 256 }) } : undefined,
        fields: [
          { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
          { name: 'Members', value: String(g.memberCount), inline: true },
          { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (level ${g.premiumTier})`, inline: true },
          { name: 'Channels', value: `${count(ChannelType.GuildText)} text, ${count(ChannelType.GuildVoice)} voice`, inline: true },
          { name: 'Roles', value: String(g.roles.cache.size - 1), inline: true },
          { name: 'Created', value: ts(g.createdTimestamp), inline: true },
        ],
        footer: { text: `ID ${g.id}` },
      }],
    });
  }

  const user = i.options.getUser('user') ?? i.user;
  if (i.commandName === 'avatar') {
    const url = user.displayAvatarURL({ size: 1024 });
    return i.reply({ embeds: [{ title: `${user.username}'s avatar`, url, image: { url }, color: colors.brand }] });
  }

  const member = i.options.getMember('user') ?? (user.id === i.user.id ? i.member : null);
  const fields = [{ name: 'Account created', value: ts(user.createdTimestamp) }];
  if (member) {
    const roles = member.roles.cache.filter(r => r.id !== i.guildId).sort((a, b) => b.position - a.position);
    fields.push({ name: 'Joined server', value: ts(member.joinedTimestamp) });
    fields.push({ name: `Roles (${roles.size})`, value: roles.first(15).join(' ') || 'none' });
  }
  if (isStaff(i.member)) {
    const cases = db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ?').get(i.guildId, user.id).n;
    fields.push({ name: 'Moderation cases', value: String(cases), inline: true });
  }
  return i.reply({
    embeds: [{
      title: member?.displayName ?? user.username,
      description: `${user}${user.bot ? ' (bot)' : ''}`,
      color: member?.displayColor || colors.brand,
      thumbnail: { url: user.displayAvatarURL({ size: 256 }) },
      fields,
      footer: { text: `ID ${user.id}` },
    }],
  });
}
