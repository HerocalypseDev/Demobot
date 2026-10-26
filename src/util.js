import { PermissionFlagsBits } from 'discord.js';
import { getSetting } from './db.js';

export const colors = { brand: 0x8b5e3c, ok: 0x4e8a5a, warn: 0xc98a2b, error: 0xb5473a, info: 0x5a6e8c };

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

// "10m", "2h", "1h30m", "1d 12h" -> milliseconds, or null if invalid.
export function parseDuration(text) {
  const clean = String(text).toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(clean)) return null;
  let ms = 0;
  for (const [, n, unit] of clean.matchAll(/(\d+)([smhdw])/g)) ms += Number(n) * UNITS[unit];
  return ms > 0 ? ms : null;
}

export function formatDuration(ms) {
  if (ms == null) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export function isStaff(member) {
  const role = getSetting(member.guild.id, 'staff_role');
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || (role && member.roles.cache.has(role));
}

export async function sendLog(guild, embed, files = []) {
  const id = getSetting(guild.id, 'log_channel');
  const channel = id && guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [{
      color: colors.info,
      timestamp: new Date().toISOString(),
      footer: { text: guild.name, icon_url: guild.iconURL({ size: 64 }) ?? undefined },
      ...embed,
    }],
    files,
  }).catch(console.error);
}
