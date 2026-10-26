import { getSetting } from '../db.js';
import { colors, sendLog } from '../util.js';

export const name = 'logs';

const clip = (text, max = 1024) => (text.length > max ? text.slice(0, max - 3) + '...' : text) || '(empty)';
const age = ms => `<t:${Math.floor(ms / 1000)}:R>`;
const skip = m => !m.inGuild() || m.author?.bot || m.channelId === getSetting(m.guildId, 'log_channel');

export const events = {
  async messageDelete(m) {
    if (m.partial || skip(m)) return;
    const files = [...m.attachments.values()].map(a => a.name).join(', ');
    await sendLog(m.guild, {
      title: 'Message deleted',
      color: colors.error,
      description: `By ${m.author} in ${m.channel}`,
      fields: [{ name: 'Content', value: clip(m.content) }, ...(files ? [{ name: 'Attachments', value: clip(files) }] : [])],
    });
  },

  async messageUpdate(before, after) {
    if (before.partial || skip(after) || before.content === after.content) return;
    await sendLog(after.guild, {
      title: 'Message edited',
      color: colors.warn,
      description: `By ${after.author} in ${after.channel} ([jump](${after.url}))`,
      fields: [{ name: 'Before', value: clip(before.content) }, { name: 'After', value: clip(after.content) }],
    });
  },

  async guildMemberAdd(member) {
    await sendLog(member.guild, {
      title: 'Member joined',
      color: colors.ok,
      description: `${member} (${member.user.username})\nAccount created ${age(member.user.createdTimestamp)}`,
      thumbnail: { url: member.displayAvatarURL({ size: 64 }) },
    });
  },

  async guildMemberRemove(member) {
    await sendLog(member.guild, {
      title: 'Member left',
      color: colors.warn,
      description: `${member} (${member.user.username})${member.joinedTimestamp ? `\nJoined ${age(member.joinedTimestamp)}` : ''}`,
    });
  },

  async guildMemberUpdate(before, after) {
    if (before.partial) return;
    const changes = [];
    if (before.nickname !== after.nickname) changes.push(`Nickname: ${before.nickname ?? 'none'} to ${after.nickname ?? 'none'}`);
    const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
    if (added.size) changes.push(`Roles added: ${added.map(r => `${r}`).join(', ')}`);
    if (removed.size) changes.push(`Roles removed: ${removed.map(r => `${r}`).join(', ')}`);
    if (!changes.length) return;
    await sendLog(after.guild, { title: 'Member updated', color: colors.info, description: `${after}\n${changes.join('\n')}` });
  },
};
