import {
  SlashCommandBuilder, InteractionContextType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { db, getSettings } from '../db.js';
import { colors, isStaff } from '../util.js';
import { keys } from './core.js';

export const name = 'dashboard';

const DAY = 86_400_000;
const SECTIONS = { overview: 'Overview', tickets: 'Tickets', moderation: 'Moderation', community: 'Community' };

export function formatDuration(ms) {
  if (ms == null) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

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

function sectionEmbed(guild, section, now = Date.now()) {
  const id = guild.id;
  const since = now - 7 * DAY;
  const t = ticketStats(id, now);
  const v = verifyStats(id, now);
  const passRate = v.pass + v.fail ? `${Math.round((100 * v.pass) / (v.pass + v.fail))}%` : 'n/a';
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const giveaways = count('SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND ended = 0', id);
  const suggestions = count("SELECT COUNT(*) AS n FROM suggestions WHERE guild_id = ? AND status = 'open'", id);
  const applications = count("SELECT COUNT(*) AS n FROM applications WHERE guild_id = ? AND status = 'pending'", id);
  const cases = db.prepare('SELECT action, COUNT(*) AS n FROM cases WHERE guild_id = ? AND created_at >= ? GROUP BY action ORDER BY n DESC').all(id, since);
  const caseTotal = cases.reduce((sum, c) => sum + c.n, 0);
  const rating = t.ratings ? `${t.avgRating.toFixed(1)}/5 from ${t.ratings}` : 'n/a';

  const fields = {
    overview: () => {
      const settings = getSettings(id);
      const missing = Object.entries(keys).filter(([k, s]) => s.type !== 'number' && !settings[k]).map(([, s]) => s.label);
      return [
        { name: 'Members', value: String(guild.memberCount), inline: true },
        { name: 'Open tickets', value: String(t.open), inline: true },
        { name: 'Cases (7d)', value: String(caseTotal), inline: true },
        { name: 'Verified today', value: String(v.passToday), inline: true },
        { name: 'Open suggestions', value: String(suggestions), inline: true },
        { name: 'Pending applications', value: String(applications), inline: true },
        { name: 'Setup', value: missing.length ? `Not set: ${missing.join(', ')}. Use \`/setup\`.` : 'Everything is set up.' },
      ];
    },
    tickets: () => {
      const top = db.prepare(`SELECT claimer_id, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND claimed_at >= ?
        GROUP BY claimer_id ORDER BY n DESC LIMIT 3`).all(id, since);
      return [
        { name: 'Open now', value: String(t.open), inline: true },
        { name: 'Opened (7d)', value: String(t.opened), inline: true },
        { name: 'Closed (7d)', value: String(t.closed), inline: true },
        { name: 'Avg time to claim (7d)', value: formatDuration(t.avgClaim), inline: true },
        { name: 'Avg rating', value: rating, inline: true },
        { name: 'Top staff (7d)', value: top.map((r, n) => `${n + 1}. <@${r.claimer_id}> ${r.n} claimed`).join('\n') || 'n/a' },
      ];
    },
    moderation: () => [
      { name: 'Cases (7d)', value: cases.map(c => `${c.action}: ${c.n}`).join('\n') || 'none', inline: true },
      { name: 'Verification (7d)', value: `Passed: ${v.pass}\nFailed: ${v.fail}\nToo new: ${v.tooNew}\nPass rate: ${passRate}`, inline: true },
    ],
    community: () => [
      { name: 'Running giveaways', value: String(giveaways), inline: true },
      { name: 'Open suggestions', value: String(suggestions), inline: true },
      { name: 'Pending applications', value: String(applications), inline: true },
    ],
  }[section]();

  return { title: `${guild.name} dashboard: ${SECTIONS[section]}`, color: colors.brand, fields, timestamp: new Date(now).toISOString() };
}

function view(guild, section) {
  return {
    embeds: [sectionEmbed(guild, section)],
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('dashboard:view')
        .addOptions(Object.entries(SECTIONS).map(([value, label]) => ({ label, value, default: value === section })))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dashboard:refresh:${section}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary)),
    ],
  };
}

export const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Staff dashboard with server stats').setContexts(InteractionContextType.Guild),
];

const denied = { content: 'Only staff can open the dashboard.', flags: MessageFlags.Ephemeral };

export async function onCommand(i) {
  if (!isStaff(i.member)) return i.reply(denied);
  await i.reply({ ...view(i.guild, 'overview'), flags: MessageFlags.Ephemeral });
}

export async function onComponent(i, action, [section]) {
  if (!isStaff(i.member)) return i.reply(denied);
  const next = action === 'view' ? i.values[0] : section;
  if (!SECTIONS[next]) return;
  await i.update(view(i.guild, next));
}
