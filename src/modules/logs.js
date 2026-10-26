import { getSetting } from '../db.js';
import { colors, sendLog } from '../util.js';
import { time, userAuthor } from '../ui.js';

export const name = 'logs';

const clip = (text, max = 1024) => (text.length > max ? text.slice(0, max - 3) + '...' : text) || '(empty)';
const skip = m => !m.inGuild() || m.author?.bot || m.channelId === getSetting(m.guildId, 'log_channel');
const userId = user => `\n-# User ID ${user.id}`;

export const events = {
  async messageDelete(m) {
    if (m.partial || skip(m)) return;
    const files = [...m.attachments.values()].map(a => a.name).join(', ');
    await sendLog(m.guild, {
      author: userAuthor(m.author),
      title: 'Message deleted',
      color: colors.error,
      description: `Sent by ${m.author} in ${m.channel} ${time(m.createdTimestamp)}${userId(m.author)}`,
      fields: [{ name: 'Content', value: clip(m.content) }, ...(files ? [{ name: 'Attachments', value: clip(files) }] : [])],
    });
  },

  async messageUpdate(before, after) {
    if (before.partial || skip(after) || before.content === after.content) return;
    await sendLog(after.guild, {
      author: userAuthor(after.author),
      title: 'Message edited',
      color: colors.warn,
      description: `By ${after.author} in ${after.channel}, [jump to message](${after.url})${userId(after.author)}`,
      fields: [{ name: 'Before', value: clip(before.content) }, { name: 'After', value: clip(after.content) }],
    });
  },

  async guildMemberAdd(member) {
    const accountAge = Date.now() - member.user.createdTimestamp;
    await sendLog(member.guild, {
      author: userAuthor(member.user),
      title: 'Member joined',
      color: colors.ok,
      description: `${member} is member #${member.guild.memberCount}${userId(member)}`,
      fields: [{ name: 'Account created', value: `${time(member.user.createdTimestamp)}${accountAge < 7 * 86_400_000 ? ' (new account)' : ''}` }],
      thumbnail: { url: member.displayAvatarURL({ size: 128 }) },
    });
  },

  async guildMemberRemove(member) {
    await sendLog(member.guild, {
      author: userAuthor(member.user),
      title: 'Member left',
      color: colors.warn,
      description: `${member} left the server${member.joinedTimestamp ? `, joined ${time(member.joinedTimestamp)}` : ''}${userId(member)}`,
      thumbnail: { url: member.displayAvatarURL({ size: 128 }) },
    });
  },

  async guildMemberUpdate(before, after) {
    if (before.partial) return;
    const changes = [];
    if (before.nickname !== after.nickname) changes.push({ name: 'Nickname', value: `${before.nickname ?? 'none'} to ${after.nickname ?? 'none'}` });
    const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
    if (added.size) changes.push({ name: 'Roles added', value: added.map(r => `${r}`).join(', ') });
    if (removed.size) changes.push({ name: 'Roles removed', value: removed.map(r => `${r}`).join(', ') });
    if (!changes.length) return;
    await sendLog(after.guild, {
      author: userAuthor(after.user),
      title: 'Member updated',
      color: colors.info,
      description: `${after}${userId(after)}`,
      fields: changes,
    });
  },
};
