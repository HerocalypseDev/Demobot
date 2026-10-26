import { PermissionFlagsBits } from 'discord.js';
import { getSetting } from './db.js';

export const colors = { brand: 0x8b5e3c, ok: 0x3ba55c, warn: 0xfaa61a, error: 0xed4245, info: 0x5865f2 };

export function isStaff(member) {
  const role = getSetting(member.guild.id, 'staff_role');
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || (role && member.roles.cache.has(role));
}

export async function sendLog(guild, embed) {
  const id = getSetting(guild.id, 'log_channel');
  const channel = id && guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [{ color: colors.info, timestamp: new Date().toISOString(), ...embed }] }).catch(console.error);
}
