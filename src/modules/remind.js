import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { db } from '../db.js';
import { colors, parseDuration } from '../util.js';

export const name = 'remind';

const MAX_DURATION = 365 * 86_400_000;
const MAX_PER_USER = 25;

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  new SlashCommandBuilder().setName('remind').setDescription('Personal reminders')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('set').setDescription('Set a reminder')
      .addStringOption(o => o.setName('in').setDescription('For example 10m, 2h, 3d').setRequired(true))
      .addStringOption(o => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(500)))
    .addSubcommand(s => s.setName('list').setDescription('Show your reminders'))
    .addSubcommand(s => s.setName('cancel').setDescription('Cancel a reminder')
      .addIntegerOption(o => o.setName('id').setDescription('Reminder number from /remind list').setRequired(true).setMinValue(1))),
];

export async function onCommand(i) {
  const sub = i.options.getSubcommand();

  if (sub === 'set') {
    const ms = parseDuration(i.options.getString('in'));
    if (!ms || ms > MAX_DURATION) return i.reply(ephemeral('Use a time like 10m, 2h or 3d, up to 365d.'));
    const count = db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?').get(i.user.id).n;
    if (count >= MAX_PER_USER) return i.reply(ephemeral(`You can have at most ${MAX_PER_USER} reminders.`));
    const due = Date.now() + ms;
    const { id } = db.prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .get(i.user.id, i.guildId, i.channelId, i.options.getString('text'), due, Date.now());
    return i.reply(ephemeral(`Reminder #${id} set for <t:${Math.floor(due / 1000)}:R>.`));
  }

  if (sub === 'list') {
    const rows = db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at').all(i.user.id);
    const description = rows.map(r => `**#${r.id}** <t:${Math.floor(r.due_at / 1000)}:R> ${r.text}`).join('\n') || 'No reminders.';
    return i.reply({ embeds: [{ title: 'Your reminders', color: colors.brand, description }], flags: MessageFlags.Ephemeral });
  }

  const removed = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(i.options.getInteger('id'), i.user.id).changes;
  return i.reply(ephemeral(removed ? 'Reminder cancelled.' : 'You have no reminder with that number.'));
}

export async function tick(client) {
  for (const r of db.prepare('SELECT * FROM reminders WHERE due_at <= ?').all(Date.now())) {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(r.id);
    const text = `Reminder from <t:${Math.floor(r.created_at / 1000)}:R>: ${r.text}`;
    const sent = await client.users.send(r.user_id, text).then(() => true, () => false);
    if (!sent) {
      // DMs closed: fall back to the channel it was set in, pinging only that user.
      await client.channels.cache.get(r.channel_id)?.send({ content: `<@${r.user_id}> ${text}`, allowedMentions: { users: [r.user_id] } }).catch(() => {});
    }
  }
}
