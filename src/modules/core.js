import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags } from 'discord.js';
import { getSettings, setSetting } from '../db.js';
import { colors } from '../util.js';

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

export async function onCommand(i) {
  if (i.commandName === 'ping') return i.reply({ content: `Pong. Gateway latency ${i.client.ws.ping} ms.`, flags: MessageFlags.Ephemeral });

  if (i.commandName === 'help') {
    const fields = i.client.modules.filter(m => m.commands?.length).map(m => ({
      name: m.name[0].toUpperCase() + m.name.slice(1),
      value: m.commands.map(c => `\`/${c.name}\` ${c.description}`).join('\n'),
    }));
    return i.reply({ embeds: [{ title: 'Demobot commands', color: colors.brand, fields }], flags: MessageFlags.Ephemeral });
  }

  const sub = i.options.getSubcommand();
  if (sub === 'view') {
    const settings = getSettings(i.guildId);
    const description = Object.entries(keys).map(([key, k]) => `**${k.label}:** ${show(key, settings[key])}`).join('\n');
    return i.reply({ embeds: [{ title: 'Server settings', color: colors.brand, description }], flags: MessageFlags.Ephemeral });
  }

  const key = i.options.getString('key');
  const value = sub === 'reset' ? null
    : sub === 'role' ? i.options.getRole('role').id
    : sub === 'number' ? String(i.options.getInteger('value'))
    : i.options.getChannel(sub).id;
  setSetting(i.guildId, key, value);
  await i.reply({ content: `${keys[key].label} set to ${show(key, value)}.`, flags: MessageFlags.Ephemeral });
}
