import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { db } from '../db.js';
import { colors, parseDuration } from '../util.js';
import { card, time } from '../ui.js';

export const name = 'giveaway';

const MAX_DURATION = 30 * 86_400_000;

// Partial Fisher-Yates with a crypto RNG: unique winners, never more than the pool.
export function pickWinners(pool, count) {
  const a = [...pool];
  const n = Math.min(count, a.length);
  for (let k = 0; k < n; k++) {
    const j = randomInt(k, a.length);
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a.slice(0, n);
}

const entriesOf = id => db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id).map(r => r.user_id);
const entryCount = id => db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id).n;
const ts = time;
const mentions = ids => ids.map(id => `<@${id}>`).join(', ');

// Always rebuilt with the banner file, so updates through button clicks keep the image.
function giveawayMessage(g) {
  const winnerIds = g.winner_ids ? JSON.parse(g.winner_ids) : [];
  const entries = entryCount(g.id);
  return card({
    accent: g.ended ? colors.info : colors.brand,
    banner: 'giveaway',
    title: g.prize,
    body: g.ended ? 'This giveaway has ended.' : 'Press **Enter** to join. Press it again to leave.',
    blocks: [g.ended
      ? `**Winners** ${winnerIds.length ? mentions(winnerIds) : 'no valid entries'}\n**Entries** ${entries}\n**Hosted by** <@${g.host_id}>\n**Ended** ${ts(g.ends_at, 'R')}`
      : `**Ends** ${ts(g.ends_at, 'R')} (${ts(g.ends_at, 'f')})\n**Winners** ${g.winners}\n**Entries** ${entries}\n**Hosted by** <@${g.host_id}>`],
    footer: `Giveaway #${g.id}. Winners are picked at random when it ends.`,
    rows: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:enter:${g.id}`).setLabel(g.ended ? `Ended (${entries} entries)` : `Enter (${entries})`)
        .setStyle(ButtonStyle.Success).setDisabled(Boolean(g.ended)))],
  });
}

const winnerCard = (g, winners, title) => ({
  ...card({
    accent: colors.ok,
    body: `### ${title}\n${mentions(winners)} won **${g.prize}**.`,
    footer: `Giveaway #${g.id}, hosted by <@${g.host_id}>`,
  }),
  allowedMentions: { users: winners },
});

async function endGiveaway(client, g) {
  if (db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ? AND ended = 0').run(g.id).changes !== 1) return;
  const winners = pickWinners(entriesOf(g.id), g.winners);
  db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(winners), g.id);
  const channel = client.channels.cache.get(g.channel_id);
  if (!channel) return;
  const message = await channel.messages.fetch(g.message_id).catch(() => null);
  await message?.edit(giveawayMessage({ ...g, ended: 1, winner_ids: JSON.stringify(winners) }));
  await channel.send({
    ...(winners.length
      ? winnerCard(g, winners, 'Congratulations')
      : card({ accent: colors.warn, body: `### No winners\nGiveaway #${g.id} for **${g.prize}** ended with no entries.` })),
    reply: message ? { messageReference: message.id } : undefined,
  });
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });
const idOpt = o => o.setName('id').setDescription('Giveaway number (shown in the footer)').setRequired(true).setMinValue(1);

export const commands = [
  new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('start').setDescription('Start a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('What the winners get').setRequired(true).setMaxLength(200))
      .addStringOption(o => o.setName('duration').setDescription('For example 30m, 1d, 1w (max 30d)').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
      .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway now').addIntegerOption(idOpt))
    .addSubcommand(s => s.setName('reroll').setDescription('Pick new winners for an ended giveaway').addIntegerOption(idOpt)
      .addIntegerOption(o => o.setName('count').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)))
    .addSubcommand(s => s.setName('list').setDescription('List running giveaways')),
];

export async function onCommand(i) {
  const sub = i.options.getSubcommand();

  if (sub === 'start') {
    const ms = parseDuration(i.options.getString('duration'));
    if (!ms || ms < 60_000 || ms > MAX_DURATION) return i.reply(ephemeral('Use a duration from 1m to 30d, like 30m or 2d.'));
    const channel = i.options.getChannel('channel') ?? i.channel;
    const g = db.prepare(`INSERT INTO giveaways (guild_id, channel_id, host_id, prize, winners, ends_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
      .get(i.guildId, channel.id, i.user.id, i.options.getString('prize'), i.options.getInteger('winners') ?? 1, Date.now() + ms);
    const message = await channel.send(giveawayMessage(g)).catch(err => {
      db.prepare('DELETE FROM giveaways WHERE id = ?').run(g.id);
      throw err;
    });
    db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(message.id, g.id);
    return i.reply(ephemeral(`Giveaway #${g.id} started in ${channel}.`));
  }

  if (sub === 'list') {
    const rows = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at').all(i.guildId);
    return i.reply(card({
      title: 'Running giveaways',
      body: `${rows.length} running in this server.`,
      blocks: rows.slice(0, 10).map(g => `**#${g.id} ${g.prize}**\nIn <#${g.channel_id}>, ends ${ts(g.ends_at, 'R')}, ${entryCount(g.id)} entries`),
      footer: rows.length ? 'Use /giveaway end with the number to end one early.' : 'Start one with /giveaway start.',
      ephemeral: true,
    }));
  }

  const g = db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(i.options.getInteger('id'), i.guildId);
  if (!g) return i.reply(ephemeral('No giveaway with that number in this server.'));

  if (sub === 'end') {
    if (g.ended) return i.reply(ephemeral('That giveaway already ended.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await endGiveaway(i.client, g);
    return i.editReply(`Giveaway #${g.id} ended.`);
  }

  if (sub === 'reroll') {
    if (!g.ended) return i.reply(ephemeral('That giveaway is still running. End it first.'));
    const previous = JSON.parse(g.winner_ids ?? '[]');
    const winners = pickWinners(entriesOf(g.id).filter(id => !previous.includes(id)), i.options.getInteger('count') ?? 1);
    if (!winners.length) return i.reply(ephemeral('No other entries left to pick from.'));
    db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify([...previous, ...winners]), g.id);
    return i.reply(winnerCard(g, winners, 'New winner picked'));
  }
}

export async function onComponent(i, action, [id]) {
  if (action !== 'enter') return;
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(Number(id));
  if (!g || g.ended) return i.reply(ephemeral('This giveaway has ended.'));
  const left = db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(g.id, i.user.id).changes;
  if (!left) db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(g.id, i.user.id);
  // Updating through the interaction avoids the channel's message edit rate limit.
  await i.update(giveawayMessage(g));
  return i.followUp(ephemeral(left ? 'You left the giveaway.' : 'You entered the giveaway. Good luck!'));
}

export async function tick(client) {
  for (const g of db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(Date.now())) {
    await endGiveaway(client, g);
  }
}
