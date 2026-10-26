import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags, ApplicationCommandOptionType,
} from 'discord.js';
import { getSettings, setSetting } from '../db.js';
import { formatDuration } from '../util.js';
import { card, cmd } from '../ui.js';
import pkg from '../../package.json' with { type: 'json' };

export const name = 'core';

export const keys = {
  log_channel: { label: 'Log channel', type: 'channel' },
  welcome_channel: { label: 'Welcome channel', type: 'channel' },
  suggestion_channel: { label: 'Suggestion channel', type: 'channel' },
  application_channel: { label: 'Application review channel', type: 'channel' },
  ticket_category: { label: 'Ticket category', type: 'category' },
  staff_role: { label: 'Staff role', type: 'role' },
  verified_role: { label: 'Verified role', type: 'role' },
  autorole: { label: 'Role given on join', type: 'role' },
  verify_min_age_days: { label: 'Minimum account age to verify (days)', type: 'number' },
};

const choicesOf = type => Object.entries(keys).filter(([, k]) => !type || k.type === type).map(([value, k]) => ({ name: k.label, value }));
const keyOption = type => o => o.setName('key').setDescription('Setting to change').setRequired(true).addChoices(...choicesOf(type));

export const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Configure the bot for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('view').setDescription('Show all settings'))
    .addSubcommand(s => s.setName('channel').setDescription('Set a channel').addStringOption(keyOption('channel'))
      .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('category').setDescription('Set a category').addStringOption(keyOption('category'))
      .addChannelOption(o => o.setName('category').setDescription('Category').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand(s => s.setName('role').setDescription('Set a role').addStringOption(keyOption('role'))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('number').setDescription('Set a number').addStringOption(keyOption('number'))
      .addIntegerOption(o => o.setName('value').setDescription('Value').setRequired(true).setMinValue(0).setMaxValue(365)))
    .addSubcommand(s => s.setName('reset').setDescription('Clear a setting').addStringOption(keyOption())),
  new SlashCommandBuilder().setName('help').setDescription('List all commands').setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is online').setContexts(InteractionContextType.Guild),
];

function show(key, value) {
  if (value == null) return 'not set';
  const { type } = keys[key];
  if (type === 'role') return `<@&${value}>`;
  if (type === 'number') return value;
  return `<#${value}>`;
}

const GROUPS = [
  ['Setup and info', ['core', 'dashboard', 'info', 'embed']],
  ['Safety', ['verify', 'mod', 'automod']],
  ['Support', ['tickets', 'apply']],
  ['Community', ['roles', 'welcome', 'giveaway', 'suggest', 'remind']],
];

function commandLine(client, command) {
  const subs = (command.toJSON().options ?? []).filter(o => o.type === ApplicationCommandOptionType.Subcommand);
  if (!subs.length) return `${cmd(client, command.name)} ${command.description}`;
  return `**/${command.name}** ${command.description}\n-# ${subs.map(o => cmd(client, `${command.name} ${o.name}`)).join('  ')}`;
}

export async function onCommand(i) {
  if (i.commandName === 'ping') {
    return i.reply(card({
      title: 'Pong',
      blocks: [`**Gateway** ${i.client.ws.ping} ms\n**Round trip** ${Date.now() - i.createdTimestamp} ms\n**Uptime** ${formatDuration(i.client.uptime)}`],
      footer: `Demobot v${pkg.version}`,
      ephemeral: true,
    }));
  }

  if (i.commandName === 'help') {
    const byName = new Map(i.client.modules.map(m => [m.name, m]));
    const blocks = GROUPS.map(([title, names]) =>
      `### ${title}\n${names.flatMap(n => byName.get(n)?.commands ?? []).map(c => commandLine(i.client, c)).join('\n')}`);
    return i.reply(card({
      banner: 'help',
      title: 'Commands',
      body: 'Everything Demobot can do. Click a command to use it.',
      blocks,
      footer: `Demobot v${pkg.version}. Staff commands only work for members with the right permissions.`,
      ephemeral: true,
    }));
  }

  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const settings = getSettings(i.guildId);
    const list = types => Object.entries(keys).filter(([, k]) => types.includes(k.type))
      .map(([key, k]) => `**${k.label}**  ${settings[key] != null ? show(key, settings[key]) : 'Missing'}`).join('\n');
    const total = Object.keys(keys).length;
    const set = Object.keys(keys).filter(k => settings[k] != null).length;
    return i.reply(card({
      title: 'Server settings',
      body: `${set} of ${total} settings configured.`,
      thumbnail: i.guild.iconURL({ size: 128 }) ?? undefined,
      blocks: [`### Channels\n${list(['channel', 'category'])}`, `### Roles\n${list(['role'])}`, `### Verification\n${list(['number'])}`],
      footer: `Change settings with ${['channel', 'category', 'role', 'number'].map(s => cmd(i.client, `setup ${s}`)).join(', ')}.`,
      ephemeral: true,
    }));
  }

  const key = i.options.getString('key');
  const value = sub === 'reset' ? null
    : sub === 'role' ? i.options.getRole('role').id
    : sub === 'number' ? String(i.options.getInteger('value'))
    : i.options.getChannel(sub).id;
  setSetting(i.guildId, key, value);
  await i.reply({ content: `${keys[key].label} set to ${show(key, value)}.`, flags: MessageFlags.Ephemeral });
}
