import { SlashCommandBuilder, InteractionContextType, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db } from '../db.js';
import { colors, isStaff } from '../util.js';
import { card, time } from '../ui.js';

export const name = 'info';

const date = ms => `${time(ms, 'D')} (${time(ms)})`;
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
    return i.reply(card({
      image: g.bannerURL({ size: 1024 }) ?? undefined,
      title: g.name,
      body: g.description ?? 'Server overview',
      thumbnail: g.iconURL({ size: 256 }) ?? undefined,
      blocks: [
        `**Owner** <@${g.ownerId}>\n**Created** ${date(g.createdTimestamp)}`,
        `**Members** ${g.memberCount}\n**Channels** ${count(ChannelType.GuildText)} text, ${count(ChannelType.GuildVoice)} voice, ${count(ChannelType.GuildCategory)} categories\n**Roles** ${g.roles.cache.size - 1}\n**Boosts** ${g.premiumSubscriptionCount ?? 0} (level ${g.premiumTier})`,
      ],
      footer: `Server ID ${g.id}`,
    }));
  }

  // A forced fetch is the only way to get the profile banner.
  const user = await i.client.users.fetch((i.options.getUser('user') ?? i.user).id, { force: true });

  if (i.commandName === 'avatar') {
    const link = (label, extension) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label)
      .setURL(user.displayAvatarURL({ extension, size: 1024, forceStatic: extension !== 'gif' }));
    const formats = [['PNG', 'png'], ['WebP', 'webp'], ['JPG', 'jpg'], ...(user.avatar?.startsWith('a_') ? [['GIF', 'gif']] : [])];
    return i.reply(card({
      title: `${user.displayName}'s avatar`,
      image: user.displayAvatarURL({ size: 1024 }),
      rows: [new ActionRowBuilder().addComponents(formats.map(([label, ext]) => link(label, ext)))],
    }));
  }

  const member = i.options.getMember('user') ?? (user.id === i.user.id ? i.member : null);
  const blocks = [`**Account created** ${date(user.createdTimestamp)}${member ? `\n**Joined server** ${date(member.joinedTimestamp)}` : ''}`];
  if (member) {
    const roles = member.roles.cache.filter(r => r.id !== i.guildId).sort((a, b) => b.position - a.position);
    blocks.push(`**Roles (${roles.size})**\n${roles.first(15).join(' ') || 'none'}`);
  }
  if (isStaff(i.member)) {
    const cases = db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ?').get(i.guildId, user.id).n;
    blocks.push(`**Moderation cases** ${cases}`);
  }
  return i.reply(card({
    accent: member?.displayColor || colors.brand,
    image: user.bannerURL({ size: 1024 }) ?? undefined,
    title: member?.displayName ?? user.displayName,
    body: `${user} (${user.username})${user.bot ? ', bot' : ''}`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    blocks,
    footer: `User ID ${user.id}`,
  }));
}
