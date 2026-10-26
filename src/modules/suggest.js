import {
  SlashCommandBuilder, InteractionContextType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { db, getSetting } from '../db.js';
import { colors, isStaff } from '../util.js';
import { bar, card } from '../ui.js';

export const name = 'suggest';

const STATUS = {
  open: { label: 'Open', color: colors.brand },
  approved: { label: 'Approved', color: colors.ok },
  denied: { label: 'Denied', color: colors.error },
};

// Same vote twice removes it, the other vote switches it. Returns the vote now stored (0 = none).
export function castVote(id, userId, vote) {
  const current = db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').get(id, userId)?.vote;
  if (current === vote) {
    db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(id, userId);
    return 0;
  }
  db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET vote = excluded.vote')
    .run(id, userId, vote);
  return vote;
}

export const voteCounts = id => db.prepare(`SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down
  FROM suggestion_votes WHERE suggestion_id = ?`).get(id);

const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');

function suggestionMessage(s, client) {
  const { up, down } = voteCounts(s.id);
  const status = STATUS[s.status];
  const open = s.status === 'open';
  const button = (id, label, style) => new ButtonBuilder().setCustomId(`suggest:${id}:${s.id}`).setLabel(label).setStyle(style).setDisabled(!open);
  return card({
    accent: status.color,
    title: `Suggestion #${s.id}`,
    body: `From <@${s.author_id}>\n-# ${status.label}`,
    thumbnail: client.users.cache.get(s.author_id)?.displayAvatarURL({ size: 128 }),
    blocks: [
      quote(s.text),
      `**Votes** ${up} up, ${down} down\n${bar(up / (up + down))} in favor`,
      !open && `**${status.label} by** <@${s.staff_id}>\n${quote(s.staff_reason || 'No reason given.')}`,
    ],
    footer: open ? 'Vote with the buttons. Press your vote again to remove it.' : 'Voting is closed.',
    rows: [new ActionRowBuilder().addComponents(
      button('up', `Up (${up})`, ButtonStyle.Success),
      button('down', `Down (${down})`, ButtonStyle.Danger),
      button('approve', 'Approve', ButtonStyle.Secondary),
      button('deny', 'Deny', ButtonStyle.Secondary),
    )],
  });
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  new SlashCommandBuilder().setName('suggest').setDescription('Send a suggestion to the server')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(o => o.setName('text').setDescription('Your idea').setRequired(true).setMinLength(10).setMaxLength(1500)),
];

export async function onCommand(i) {
  const channel = i.guild.channels.cache.get(getSetting(i.guildId, 'suggestion_channel'));
  if (!channel) return i.reply(ephemeral('Suggestions are not set up yet. Staff can set a channel with `/setup channel`.'));
  const s = db.prepare('INSERT INTO suggestions (guild_id, author_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING *')
    .get(i.guildId, i.user.id, i.options.getString('text'), Date.now());
  const message = await channel.send(suggestionMessage(s, i.client));
  await message.startThread({ name: `Suggestion #${s.id} discussion` }).catch(() => {}); // needs Create Public Threads
  await i.reply(ephemeral(`Suggestion #${s.id} posted in ${channel}.`));
}

export async function onComponent(i, action, [id, decision]) {
  const s = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(Number(id));
  if (!s) return i.reply(ephemeral('That suggestion no longer exists.'));

  if (action === 'up' || action === 'down') {
    if (s.status !== 'open') return i.reply(ephemeral('Voting on this suggestion is closed.'));
    castVote(s.id, i.user.id, action === 'up' ? 1 : -1);
    return i.update(suggestionMessage(s, i.client));
  }

  if (!isStaff(i.member)) return i.reply(ephemeral('Only staff can review suggestions.'));

  if (action === 'approve' || action === 'deny') {
    const status = action === 'approve' ? 'approved' : 'denied';
    return i.showModal(new ModalBuilder().setCustomId(`suggest:decide:${s.id}:${status}`).setTitle(`${STATUS[status].label}: suggestion #${s.id}`)
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false))));
  }

  if (action === 'decide') {
    if (!STATUS[decision] || s.status !== 'open') return i.reply(ephemeral('This suggestion was already reviewed.'));
    const reason = i.fields.getTextInputValue('reason');
    db.prepare('UPDATE suggestions SET status = ?, staff_id = ?, staff_reason = ? WHERE id = ?').run(decision, i.user.id, reason, s.id);
    const updated = { ...s, status: decision, staff_id: i.user.id, staff_reason: reason };
    await i.update(suggestionMessage(updated, i.client));
    await i.client.users.send(s.author_id, `Your suggestion #${s.id} in **${i.guild.name}** was ${decision}.${reason ? ` Reason: ${reason}` : ''}`)
      .catch(() => {});
  }
}
