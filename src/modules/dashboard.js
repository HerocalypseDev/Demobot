import {
  SlashCommandBuilder, InteractionContextType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { db, getSettings } from '../db.js';
import { formatDuration, isStaff } from '../util.js';
import { bar, card, time } from '../ui.js';
import { keys } from './core.js';

export const name = 'dashboard';

const DAY = 86_400_000;
const SECTIONS = {
  overview: ['Overview', 'Key numbers and setup status'],
  tickets: ['Tickets', 'Support load and staff performance'],
  moderation: ['Moderation', 'Cases and verification'],
  community: ['Community', 'Giveaways, suggestions and applications'],
};

export function ticketStats(guildId, now = Date.now()) {
  const since = now - 7 * DAY;
  return db.prepare(`SELECT
      COALESCE(SUM(closed_at IS NULL), 0) AS open,
      COALESCE(SUM(opened_at >= ?), 0) AS opened,
      COALESCE(SUM(closed_at >= ?), 0) AS closed,
      AVG(CASE WHEN opened_at >= ? THEN claimed_at - opened_at END) AS avgClaim,
      AVG(rating) AS avgRating,
      COUNT(rating) AS ratings
    FROM tickets WHERE guild_id = ?`).get(since, since, since, guildId);
}

export function verifyStats(guildId, now = Date.now()) {
  const today = now - (now % DAY);
  return db.prepare(`SELECT
      COALESCE(SUM(result = 'pass'), 0) AS pass,
      COALESCE(SUM(result = 'fail'), 0) AS fail,
      COALESCE(SUM(result = 'too_new'), 0) AS tooNew,
      COALESCE(SUM(result = 'pass' AND created_at >= ?), 0) AS passToday
    FROM verifications WHERE guild_id = ? AND created_at >= ?`).get(today, guildId, now - 7 * DAY);
}

function sectionBlocks(guild, section, now) {
  const id = guild.id;
  const since = now - 7 * DAY;
  const t = ticketStats(id, now);
  const v = verifyStats(id, now);
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const giveaways = count('SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND ended = 0', id);
  const suggestions = count("SELECT COUNT(*) AS n FROM suggestions WHERE guild_id = ? AND status = 'open'", id);
  const applications = count("SELECT COUNT(*) AS n FROM applications WHERE guild_id = ? AND status = 'pending'", id);
  const cases = db.prepare('SELECT action, COUNT(*) AS n FROM cases WHERE guild_id = ? AND created_at >= ? GROUP BY action ORDER BY n DESC').all(id, since);
  const caseTotal = cases.reduce((sum, c) => sum + c.n, 0);
  const rating = t.ratings ? `${t.avgRating.toFixed(1)}/5 from ${t.ratings} rating(s)\n${bar(t.avgRating / 5)}` : 'No ratings yet';

  if (section === 'overview') {
    const settings = getSettings(id);
    const required = Object.entries(keys).filter(([, s]) => s.type !== 'number');
    const missing = required.filter(([k]) => !settings[k]).map(([, s]) => s.label);
    return [
      `**Members** ${guild.memberCount}\n**Open tickets** ${t.open}\n**Cases this week** ${caseTotal}\n**Verified today** ${v.passToday}`,
      `**Open suggestions** ${suggestions}\n**Pending applications** ${applications}\n**Running giveaways** ${giveaways}`,
      `**Setup** ${required.length - missing.length} of ${required.length} done\n${bar((required.length - missing.length) / required.length)}`
        + (missing.length ? `\n-# Missing: ${missing.join(', ')}` : ''),
    ];
  }
  if (section === 'tickets') {
    const top = db.prepare(`SELECT claimer_id, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND claimed_at >= ?
      GROUP BY claimer_id ORDER BY n DESC LIMIT 3`).all(id, since);
    return [
      `**Open now** ${t.open}\n**Opened this week** ${t.opened}\n**Closed this week** ${t.closed}\n**Average time to claim** ${formatDuration(t.avgClaim)}`,
      `**Satisfaction**\n${rating}`,
      `**Top staff this week**\n${top.map((r, n) => `${n + 1}. <@${r.claimer_id}>, ${r.n} claimed`).join('\n') || 'No claims yet'}`,
    ];
  }
  if (section === 'moderation') {
    const attempts = v.pass + v.fail;
    return [
      `**Cases this week** ${caseTotal}\n${cases.map(c => `${c.action}: ${c.n}`).join('\n') || 'No cases. All quiet.'}`,
      `**Verification this week**\nPassed ${v.pass}, failed ${v.fail}, too new ${v.tooNew}\n${attempts ? `${bar(v.pass / attempts)} pass rate` : 'No attempts yet'}`,
    ];
  }
  return [
    `**Running giveaways** ${giveaways}\n**Open suggestions** ${suggestions}\n**Pending applications** ${applications}`,
  ];
}

function view(guild, section, ephemeral = false) {
  const now = Date.now();
  const [title, subtitle] = SECTIONS[section];
  return card({
    title,
    body: `${guild.name}\n-# ${subtitle}`,
    thumbnail: guild.iconURL({ size: 128 }) ?? undefined,
    blocks: sectionBlocks(guild, section, now),
    footer: `Updated ${time(now)}. Weekly numbers cover the last 7 days.`,
    rows: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('dashboard:view')
        .addOptions(Object.entries(SECTIONS).map(([value, [label, description]]) => ({ label, value, description, default: value === section })))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dashboard:refresh:${section}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary)),
    ],
    ephemeral,
  });
}

export const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Staff dashboard with server stats').setContexts(InteractionContextType.Guild),
];

const denied = { content: 'Only staff can open the dashboard.', flags: MessageFlags.Ephemeral };

export async function onCommand(i) {
  if (!isStaff(i.member)) return i.reply(denied);
  await i.reply(view(i.guild, 'overview', true));
}

export async function onComponent(i, action, [section]) {
  if (!isStaff(i.member)) return i.reply(denied);
  const next = action === 'view' ? i.values[0] : section;
  if (!SECTIONS[next]) return;
  await i.update(view(i.guild, next));
}
