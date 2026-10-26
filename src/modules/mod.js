import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { db } from '../db.js';
import { colors, parseDuration, sendLog } from '../util.js';
import { card, time, userAuthor } from '../ui.js';

export const name = 'mod';

const { ModerateMembers, KickMembers, BanMembers, ManageMessages } = PermissionFlagsBits;
const MAX_TIMEOUT = 28 * 86_400_000;
const PAGE = 5;
const PAST = { warn: 'warned', timeout: 'timed out', untimeout: 'removed from timeout', kick: 'kicked', ban: 'banned', unban: 'unbanned' };
const COLOR = { warn: colors.warn, timeout: colors.warn, untimeout: colors.ok, kick: colors.error, ban: colors.error, unban: colors.ok };
const LABEL = { warn: 'Warning', timeout: 'Timeout', untimeout: 'Timeout removed', kick: 'Kick', ban: 'Ban', unban: 'Unban' };

export function addCase(guildId, userId, modId, action, reason, now = Date.now()) {
  return db.prepare(`INSERT INTO cases (guild_id, number, user_id, mod_id, action, reason, created_at)
    SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, ?, ? FROM cases WHERE guild_id = ? RETURNING number`)
    .get(guildId, userId, modId, action, reason, now, guildId).number;
}

// Moderator side only. The bot side uses discord.js moderatable/kickable/bannable.
export function moderationProblem(actor, target) {
  if (target.id === actor.id) return "You can't moderate yourself.";
  if (target.id === target.guild.ownerId) return "You can't moderate the server owner.";
  if (actor.id !== actor.guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return 'Their highest role is not below yours.';
  }
  return null;
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });
const cmd = (name, description, perm) => new SlashCommandBuilder().setName(name).setDescription(description)
  .setDefaultMemberPermissions(perm).setContexts(InteractionContextType.Guild);
const userOpt = o => o.setName('user').setDescription('Member').setRequired(true);
const reasonOpt = o => o.setName('reason').setDescription('Reason').setMaxLength(500);

export const commands = [
  cmd('warn', 'Warn a member', ModerateMembers).addUserOption(userOpt).addStringOption(o => reasonOpt(o).setRequired(true)),
  cmd('timeout', 'Time out a member', ModerateMembers).addUserOption(userOpt)
    .addStringOption(o => o.setName('duration').setDescription('For example 10m, 2h, 1d (max 28d)').setRequired(true))
    .addStringOption(reasonOpt),
  cmd('untimeout', 'Remove a timeout', ModerateMembers).addUserOption(userOpt).addStringOption(reasonOpt),
  cmd('kick', 'Kick a member', KickMembers).addUserOption(userOpt).addStringOption(reasonOpt),
  cmd('ban', 'Ban a user, even one not in the server', BanMembers).addUserOption(userOpt).addStringOption(reasonOpt)
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7)),
  cmd('unban', 'Unban a user', BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(reasonOpt),
  cmd('purge', 'Bulk delete recent messages', ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user')),
  cmd('case', 'Moderation case history', ModerateMembers)
    .addSubcommand(s => s.setName('list').setDescription('Show the cases of a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a case')
      .addIntegerOption(o => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))),
];

async function finish(i, user, action, reason, duration) {
  const number = addCase(i.guildId, user.id, i.user.id, action, reason);
  const details = [`**User** ${user} (${user.username})`, `**Moderator** ${i.user}`, duration && `**Duration** ${duration}`, `**Reason** ${reason}`];
  await i.reply(card({
    accent: COLOR[action],
    title: `Case #${number}`,
    body: LABEL[action],
    thumbnail: user.displayAvatarURL({ size: 128 }),
    blocks: [details.filter(Boolean).join('\n')],
    footer: `User ID ${user.id}`,
  }));
  await sendLog(i.guild, {
    author: userAuthor(user),
    title: `Case #${number}: ${LABEL[action]}`,
    color: COLOR[action],
    description: `${user} was ${PAST[action]}${duration ? ` for ${duration}` : ''}.\n-# User ID ${user.id}`,
    fields: [{ name: 'Moderator', value: `${i.user}`, inline: true }, { name: 'Reason', value: reason, inline: true }],
  });
}

function casesPage(client, guildId, userId, page, ephemeral = false) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ?').get(guildId, userId).n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const rows = db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY number DESC LIMIT ? OFFSET ?')
    .all(guildId, userId, PAGE, page * PAGE);
  return card({
    title: 'Moderation history',
    body: `<@${userId}>, ${total} case(s)`,
    thumbnail: client.users.cache.get(userId)?.displayAvatarURL({ size: 128 }),
    blocks: rows.length
      ? rows.map(c => `**#${c.number} ${LABEL[c.action] ?? c.action}**  ${time(c.created_at)}\nby <@${c.mod_id}>\n> ${c.reason}`)
      : ['No cases. This member has a clean record.'],
    footer: `Page ${page + 1} of ${pages}`,
    rows: pages > 1 ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mod:cases:${userId}:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`mod:cases:${userId}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
    )] : [],
    ephemeral,
  });
}

export async function onCommand(i) {
  const action = i.commandName;

  if (action === 'case') {
    if (i.options.getSubcommand() === 'list') {
      return i.reply(casesPage(i.client, i.guildId, i.options.getUser('user').id, 0, true));
    }
    const number = i.options.getInteger('number');
    const removed = db.prepare('DELETE FROM cases WHERE guild_id = ? AND number = ?').run(i.guildId, number).changes;
    if (!removed) return i.reply(ephemeral(`Case #${number} does not exist.`));
    await sendLog(i.guild, { author: userAuthor(i.user), title: `Case #${number} deleted`, color: colors.warn, description: `Deleted by ${i.user}.` });
    return i.reply(ephemeral(`Case #${number} deleted.`));
  }

  if (action === 'purge') {
    const amount = i.options.getInteger('amount');
    const user = i.options.getUser('user');
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    let messages = await i.channel.messages.fetch({ limit: 100 });
    if (user) messages = messages.filter(m => m.author.id === user.id);
    const deleted = await i.channel.bulkDelete(messages.first(amount), true);
    await sendLog(i.guild, { author: userAuthor(i.user), title: 'Messages purged', color: colors.warn, description: `${i.user} deleted ${deleted.size} message(s) in ${i.channel}${user ? ` from ${user}` : ''}.` });
    return i.editReply(`Deleted ${deleted.size} message(s).${deleted.size < amount ? ' Messages older than 14 days cannot be bulk deleted.' : ''}`);
  }

  const reason = i.options.getString('reason') ?? 'No reason given';

  if (action === 'unban') {
    const id = i.options.getString('user_id').trim();
    if (!/^\d{17,20}$/.test(id)) return i.reply(ephemeral('That is not a valid user ID.'));
    const ban = await i.guild.bans.fetch(id).catch(() => null);
    if (!ban) return i.reply(ephemeral('That user is not banned.'));
    await i.guild.members.unban(id, reason);
    return finish(i, ban.user, action, reason);
  }

  const user = i.options.getUser('user');
  const member = i.options.getMember('user');
  if (!member && action !== 'ban') return i.reply(ephemeral('That user is not in this server.'));
  if (member) {
    const problem = moderationProblem(i.member, member);
    if (problem) return i.reply(ephemeral(problem));
    const botCan = { warn: true, timeout: member.moderatable, untimeout: member.moderatable, kick: member.kickable, ban: member.bannable }[action];
    if (!botCan) return i.reply(ephemeral('I can\'t do that to this member. My role must be above theirs and I need the right permission.'));
  }

  let ms, duration;
  if (action === 'timeout') {
    ms = parseDuration(i.options.getString('duration'));
    if (!ms || ms > MAX_TIMEOUT) return i.reply(ephemeral('Use a duration like 10m, 2h or 1d, up to 28d.'));
    duration = i.options.getString('duration');
  }
  if (action === 'untimeout' && !member.isCommunicationDisabled()) return i.reply(ephemeral('That member is not timed out.'));

  // DM first: after a kick or ban the bot may share no server with them.
  await user.send(card({
    accent: COLOR[action],
    title: LABEL[action],
    body: `You were ${PAST[action]}${duration ? ` for ${duration}` : ''} in **${i.guild.name}**.`,
    thumbnail: i.guild.iconURL({ size: 128 }) ?? undefined,
    blocks: [`**Reason** ${reason}`],
    footer: action === 'timeout' ? `The timeout ends ${time(Date.now() + ms)}.` : undefined,
  })).catch(() => {});

  if (action === 'timeout') await member.timeout(ms, reason);
  if (action === 'untimeout') await member.timeout(null, reason);
  if (action === 'kick') await member.kick(reason);
  if (action === 'ban') await i.guild.members.ban(user, { reason, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86_400 });
  return finish(i, user, action, reason, duration);
}

export async function onComponent(i, action, [userId, page]) {
  if (action === 'cases') return i.update(casesPage(i.client, i.guildId, userId, Number(page)));
}
