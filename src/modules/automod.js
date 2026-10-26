import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags,
  AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationActionType,
} from 'discord.js';
import { getSetting } from '../db.js';
import { card } from '../ui.js';

export const name = 'automod';

// These are Discord's native AutoMod rules. Discord enforces them, even while the bot is offline.
const RULES = {
  invites: { label: 'Block invite links', type: AutoModerationRuleTriggerType.Keyword },
  links: { label: 'Block all links', type: AutoModerationRuleTriggerType.Keyword },
  mentions: { label: 'Mention spam limit', type: AutoModerationRuleTriggerType.MentionSpam },
  words: { label: 'Blocked words', type: AutoModerationRuleTriggerType.Keyword },
};
const ruleName = key => `Demobot: ${RULES[key].label}`;

// Discord allows up to 1000 keywords of up to 60 characters each.
export function parseKeywords(text) {
  return [...new Set(text.split(',').map(w => w.trim().toLowerCase()).filter(w => w && w.length <= 60))].slice(0, 1000);
}

function triggerFor(key, i) {
  if (key === 'invites') return { regexPatterns: ['(discord\\.gg|discord(app)?\\.com/invite)/\\S+'] };
  if (key === 'links') return { regexPatterns: ['https?://\\S+'] };
  if (key === 'mentions') {
    const limit = i.options.getInteger('limit');
    return limit ? { mentionTotalLimit: limit } : null;
  }
  const words = parseKeywords(i.options.getString('list') ?? '');
  return words.length ? { keywordFilter: words } : null;
}

export const commands = [
  new SlashCommandBuilder().setName('automod').setDescription('Set up Discord AutoMod rules')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('status').setDescription('Show the rules this bot manages'))
    .addSubcommand(s => s.setName('invites').setDescription('Block Discord invite links')
      .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand(s => s.setName('links').setDescription('Block all links')
      .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand(s => s.setName('mentions').setDescription('Block messages with too many mentions')
      .addIntegerOption(o => o.setName('limit').setDescription('Max mentions per message, 0 turns it off').setRequired(true).setMinValue(0).setMaxValue(50)))
    .addSubcommand(s => s.setName('words').setDescription('Block words or phrases')
      .addStringOption(o => o.setName('list').setDescription('Comma separated. Leave empty to turn off.').setMaxLength(4000))),
];

export async function onCommand(i) {
  if (!i.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ content: 'I need the Manage Server permission to manage AutoMod rules.', flags: MessageFlags.Ephemeral });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const rules = await i.guild.autoModerationRules.fetch();
  const key = i.options.getSubcommand();

  if (key === 'status') {
    const lines = Object.keys(RULES).map(k => {
      const rule = rules.find(r => r.name === ruleName(k));
      return `**${RULES[k].label}**  ${rule?.enabled ? 'On' : 'Off'}`;
    });
    // The reply was already deferred as ephemeral, so the card itself must not set that flag.
    return i.editReply(card({
      title: 'AutoMod',
      body: 'Discord enforces these rules itself, even while the bot is offline.',
      thumbnail: i.guild.iconURL({ size: 128 }) ?? undefined,
      blocks: [lines.join('\n')],
      footer: `Staff are exempt. ${getSetting(i.guildId, 'log_channel') ? 'Alerts go to the log channel.' : 'Set a log channel to get alerts.'}`,
    }));
  }

  const existing = rules.find(r => r.name === ruleName(key));
  const trigger = (key === 'invites' || key === 'links') && !i.options.getBoolean('enabled') ? null : triggerFor(key, i);
  if (!trigger) {
    await existing?.delete();
    return i.editReply(`${RULES[key].label} is off.`);
  }

  const logChannel = getSetting(i.guildId, 'log_channel');
  const staffRole = getSetting(i.guildId, 'staff_role');
  const data = {
    name: ruleName(key),
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerMetadata: trigger,
    actions: [
      { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'This message was blocked by the server rules.' } },
      ...(logChannel ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: logChannel } }] : []),
    ],
    exemptRoles: staffRole ? [staffRole] : [],
    enabled: true,
  };
  if (existing) await existing.edit(data);
  else await i.guild.autoModerationRules.create({ ...data, triggerType: RULES[key].type });
  await i.editReply(`${RULES[key].label} is on.${logChannel ? ' Alerts go to the log channel.' : ''}`);
}
