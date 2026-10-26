import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { db, getSetting } from '../db.js';
import { colors, isStaff, sendLog } from '../util.js';

export const name = 'tickets';

export const CATEGORIES = { general: 'General help', report: 'Report a user', partnership: 'Partnership', other: 'Other' };
const PREFIX = { low: 'low', normal: 'ticket', high: 'high' };
const IDLE_WARN = 47 * 3_600_000;
const WARN_GRACE = 3_600_000;
const { ViewChannel, SendMessages, ReadMessageHistory, AttachFiles, EmbedLinks, ManageChannels, ManageMessages, ManageGuild } = PermissionFlagsBits;
const MEMBER_PERMS = [ViewChannel, SendMessages, ReadMessageHistory, AttachFiles, EmbedLinks];

export const channelName = (number, priority = 'normal') => `${PREFIX[priority]}-${String(number).padStart(4, '0')}`;

export function createTicket(guildId, openerId, category, reason, now = Date.now()) {
  return db.prepare(`INSERT INTO tickets (guild_id, number, opener_id, category, reason, opened_at, last_activity)
    SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, ?, ? FROM tickets WHERE guild_id = ? RETURNING id, number`)
    .get(guildId, openerId, category, reason, now, now, guildId);
}

export const openTicketOf = (guildId, userId) =>
  db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND closed_at IS NULL').get(guildId, userId);

const ticketIn = channelId => db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND closed_at IS NULL').get(channelId);

// Returns true only for the caller that actually closed it, so double clicks can't close twice.
export const markClosed = (id, closedBy, now = Date.now()) =>
  db.prepare('UPDATE tickets SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL').run(now, closedBy, id).changes === 1;

export function autoCloseStage(t, now = Date.now()) {
  if (t.warned_at) return now - t.warned_at >= WARN_GRACE ? 'close' : null;
  return now - t.last_activity >= IDLE_WARN ? 'warn' : null;
}

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderTranscript(title, messages) {
  const rows = messages.map(m => `<div class="msg"><b>${escapeHtml(m.author)}</b> <time>${escapeHtml(m.time)}</time>`
    + `<p>${escapeHtml(m.content)}</p>`
    + m.attachments.map(url => `<a href="${escapeHtml(url)}">${escapeHtml(url.split('?')[0].split('/').pop())}</a>`).join(' ')
    + '</div>').join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font-family:system-ui,sans-serif;background:#f6f1e7;color:#2b2118;max-width:800px;margin:2rem auto;padding:0 1rem}
.msg{border-bottom:1px solid #e0d6c4;padding:.5rem 0}p{white-space:pre-wrap;margin:.25rem 0}time{color:#8a7a66;font-size:.8em}
</style></head><body><h1>${escapeHtml(title)}</h1>
${rows}
</body></html>`;
}

async function transcriptFile(channel, t) {
  const messages = [];
  let before;
  // ponytail: capped at 1000 messages, raise the cap if tickets get longer.
  while (messages.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    messages.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  const lines = messages.reverse().map(m => ({
    author: m.member?.displayName ?? m.author.username,
    time: m.createdAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    content: [m.content, ...m.embeds.map(e => [e.title, e.description].filter(Boolean).join('\n'))].filter(Boolean).join('\n'),
    attachments: [...m.attachments.values()].map(a => a.url),
  }));
  const fileName = `${channelName(t.number)}.html`;
  return new AttachmentBuilder(Buffer.from(renderTranscript(`${channel.guild.name} ${fileName.slice(0, -5)}`, lines)), { name: fileName });
}

async function closeTicket(guild, t, closedBy, reason) {
  if (!markClosed(t.id, closedBy)) return;
  const channel = guild.channels.cache.get(t.channel_id);
  // A failed transcript must not leave a closed ticket's channel behind.
  const file = channel && await transcriptFile(channel, t).catch(err => console.error('Transcript failed:', err));
  const ts = ms => `<t:${Math.floor(ms / 1000)}:f>`;

  await sendLog(guild, {
    title: `Ticket #${t.number} closed`,
    color: colors.brand,
    fields: [
      { name: 'Opened by', value: `<@${t.opener_id}>`, inline: true },
      { name: 'Claimed by', value: t.claimer_id ? `<@${t.claimer_id}>` : 'nobody', inline: true },
      { name: 'Closed by', value: `<@${closedBy}>`, inline: true },
      { name: 'Category', value: CATEGORIES[t.category] ?? t.category, inline: true },
      { name: 'Opened', value: ts(t.opened_at), inline: true },
      { name: 'Reason', value: reason || 'none given' },
    ],
  }, file ? [file] : []);

  const rating = new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map(n =>
    new ButtonBuilder().setCustomId(`tickets:rate:${t.id}:${n}`).setLabel(String(n)).setStyle(ButtonStyle.Secondary)));
  await guild.client.users.send(t.opener_id, {
    content: `Your ticket #${t.number} in **${guild.name}** was closed. Reason: ${reason || 'none given'}.\nHow was your support? Rate it from 1 (poor) to 5 (great).`,
    files: file ? [file] : [],
    components: [rating],
  }).catch(() => {}); // DMs closed

  await channel?.delete(`Ticket #${t.number} closed`);
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket system')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('panel').setDescription('Post the ticket panel (admin)')
      .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('close').setDescription('Close this ticket')
      .addStringOption(o => o.setName('reason').setDescription('Why it is closed').setMaxLength(500)))
    .addSubcommand(s => s.setName('add').setDescription('Add a member to this ticket (staff)')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a member from this ticket (staff)')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(s => s.setName('priority').setDescription('Set ticket priority (staff)')
      .addStringOption(o => o.setName('level').setDescription('Priority').setRequired(true)
        .addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }))),
];

export async function onCommand(i) {
  const sub = i.options.getSubcommand();

  if (sub === 'panel') {
    if (!i.memberPermissions.has(ManageGuild)) return i.reply(ephemeral('You need Manage Server to post the panel.'));
    const category = i.guild.channels.cache.get(getSetting(i.guildId, 'ticket_category'));
    if (!category) return i.reply(ephemeral('Set a ticket category first with `/setup category`.'));
    if (!category.permissionsFor(i.guild.members.me).has(ManageChannels)) {
      return i.reply(ephemeral(`I need Manage Channels in the ${category.name} category.`));
    }
    const channel = i.options.getChannel('channel') ?? i.channel;
    await channel.send({
      embeds: [{ title: 'Support', description: 'Need help? Pick a topic below to open a private ticket with the staff team.', color: colors.brand }],
      components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('tickets:open').setPlaceholder('Choose a topic')
        .addOptions(Object.entries(CATEGORIES).map(([value, label]) => ({ label, value }))))],
    });
    return i.reply(ephemeral(`Ticket panel posted in ${channel}.`));
  }

  const t = ticketIn(i.channelId);
  if (!t) return i.reply(ephemeral('This command only works inside a ticket channel.'));

  if (sub === 'close') {
    if (t.opener_id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only the ticket owner or staff can close this ticket.'));
    await i.reply('Closing this ticket...');
    return closeTicket(i.guild, t, i.user.id, i.options.getString('reason'));
  }

  if (!isStaff(i.member)) return i.reply(ephemeral('Only staff can do that.'));
  const user = i.options.getUser('user');

  if (sub === 'add') {
    await i.channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    return i.reply(`${user} was added to this ticket.`);
  }
  if (sub === 'remove') {
    if (user.id === t.opener_id) return i.reply(ephemeral("You can't remove the ticket owner."));
    await i.channel.permissionOverwrites.delete(user);
    return i.reply(`${user} was removed from this ticket.`);
  }
  if (sub === 'priority') {
    const level = i.options.getString('level');
    db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(level, t.id);
    // Channel renames are rate limited (2 per 10 min), so answer first.
    await i.reply(`Priority set to **${level}**.`);
    await i.channel.setName(channelName(t.number, level)).catch(() =>
      i.followUp(ephemeral('Discord limits channel renames to 2 per 10 minutes. The name will update later.')));
  }
}

export async function onComponent(i, action, args) {
  if (action === 'rate') {
    const [id, stars] = args.map(Number);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!t || t.opener_id !== i.user.id || t.rating) return i.update({ components: [] });
    db.prepare('UPDATE tickets SET rating = ? WHERE id = ?').run(stars, id);
    await i.update({ content: `${i.message.content.split('\n')[0]}\nThanks for your feedback. You rated this ticket ${stars}/5.`, components: [] });
    const guild = i.client.guilds.cache.get(t.guild_id);
    if (guild) await sendLog(guild, { title: `Ticket #${t.number} rated ${stars}/5`, color: colors.info, description: `Rated by <@${t.opener_id}>.` });
    return;
  }

  if (action === 'open') {
    const existing = openTicketOf(i.guildId, i.user.id);
    if (existing) return i.reply(ephemeral(`You already have an open ticket: <#${existing.channel_id}>`));
    const category = i.values[0];
    return i.showModal(new ModalBuilder().setCustomId(`tickets:create:${category}`).setTitle(CATEGORIES[category]).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('What do you need help with?')
        .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true))));
  }

  if (action === 'create') {
    const category = args[0];
    if (!CATEGORIES[category]) return i.reply(ephemeral('Unknown ticket topic.'));
    if (openTicketOf(i.guildId, i.user.id)) return i.reply(ephemeral('You already have an open ticket.'));
    const parent = getSetting(i.guildId, 'ticket_category');
    if (!i.guild.channels.cache.has(parent)) return i.reply(ephemeral('Tickets are not set up on this server yet.'));

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = i.fields.getTextInputValue('reason');
    const t = createTicket(i.guildId, i.user.id, category, reason);
    const staff = getSetting(i.guildId, 'staff_role');
    let channel;
    try {
      channel = await i.guild.channels.create({
        name: channelName(t.number),
        parent,
        topic: `Ticket #${t.number} for ${i.user.username}: ${CATEGORIES[category]}`,
        permissionOverwrites: [
          { id: i.guild.roles.everyone.id, deny: [ViewChannel] },
          { id: i.user.id, allow: MEMBER_PERMS },
          { id: i.guild.members.me.id, allow: [...MEMBER_PERMS, ManageChannels] },
          ...(staff ? [{ id: staff, allow: [...MEMBER_PERMS, ManageMessages] }] : []),
        ],
      });
    } catch (err) {
      db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
      throw err;
    }
    db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?').run(channel.id, t.id);

    await channel.send({
      content: `${i.user}${staff ? ` <@&${staff}>` : ''}`,
      embeds: [{
        title: `Ticket #${t.number}: ${CATEGORIES[category]}`,
        description: reason,
        color: colors.brand,
        footer: { text: 'Staff will be with you soon. Inactive tickets close after 48 hours.' },
      }],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tickets:claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tickets:close').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tickets:transcript').setLabel('Transcript').setStyle(ButtonStyle.Secondary),
      )],
    });
    await sendLog(i.guild, { title: `Ticket #${t.number} opened`, color: colors.ok, description: `${i.user} opened ${channel} (${CATEGORIES[category]}).` });
    return i.editReply(`Your ticket is open: ${channel}`);
  }

  const t = ticketIn(i.channelId);
  if (!t) return i.reply(ephemeral('This ticket is already closed.'));

  if (action === 'claim') {
    if (!isStaff(i.member)) return i.reply(ephemeral('Only staff can claim tickets.'));
    if (t.claimer_id) return i.reply(ephemeral(`Already claimed by <@${t.claimer_id}>.`));
    db.prepare('UPDATE tickets SET claimer_id = ?, claimed_at = ? WHERE id = ?').run(i.user.id, Date.now(), t.id);
    return i.reply(`${i.user} claimed this ticket and will help you.`);
  }

  if (action === 'close') {
    if (t.opener_id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only the ticket owner or staff can close this ticket.'));
    return i.reply({
      content: 'Close this ticket? A transcript will be saved.',
      flags: MessageFlags.Ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tickets:confirm').setLabel('Close ticket').setStyle(ButtonStyle.Danger))],
    });
  }

  if (action === 'confirm') {
    if (t.opener_id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only the ticket owner or staff can close this ticket.'));
    await i.update({ content: 'Closing this ticket...', components: [] });
    return closeTicket(i.guild, t, i.user.id, null);
  }

  if (action === 'transcript') {
    if (!isStaff(i.member)) return i.reply(ephemeral('Only staff can download transcripts.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    return i.editReply({ content: 'Transcript so far:', files: [await transcriptFile(i.channel, t)] });
  }
}

export const events = {
  async messageCreate(m) {
    if (m.author.bot || !m.inGuild()) return;
    db.prepare('UPDATE tickets SET last_activity = ?, warned_at = NULL WHERE channel_id = ? AND closed_at IS NULL').run(Date.now(), m.channelId);
  },
  async channelDelete(c) {
    db.prepare("UPDATE tickets SET closed_at = ?, closed_by = 'channel deleted' WHERE channel_id = ? AND closed_at IS NULL").run(Date.now(), c.id);
  },
};

export async function tick(client) {
  const now = Date.now();
  for (const t of db.prepare('SELECT * FROM tickets WHERE closed_at IS NULL AND channel_id IS NOT NULL').all()) {
    const stage = autoCloseStage(t, now);
    if (!stage) continue;
    const guild = client.guilds.cache.get(t.guild_id);
    const channel = guild?.channels.cache.get(t.channel_id);
    if (!channel) {
      markClosed(t.id, 'channel missing', now);
      continue;
    }
    if (stage === 'warn') {
      db.prepare('UPDATE tickets SET warned_at = ? WHERE id = ?').run(now, t.id);
      await channel.send(`<@${t.opener_id}> This ticket has been inactive for 47 hours and will close in 1 hour. Send a message to keep it open.`);
    } else {
      await closeTicket(guild, t, client.user.id, 'No activity for 48 hours');
    }
  }
}
