import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { db, getSetting } from '../db.js';
import { colors, sendLog } from '../util.js';

export const name = 'verify';

const CAPTCHA_TTL = 5 * 60_000;
const MAX_FAILS = 3;
const FAIL_WINDOW = 10 * 60_000;
const DAY = 86_400_000;

// Keyed by `${guildId}:${userId}`. Answers stay in memory, never in a custom ID the client can read.
const pending = new Map();
const fails = new Map();

export function newCaptcha(now = Date.now()) {
  const a = randomInt(2, 21), b = randomInt(2, 21);
  return { question: `What is ${a} + ${b}?`, answer: a + b, expires: now + CAPTCHA_TTL };
}

export function checkAnswer(captcha, input, now = Date.now()) {
  if (!captcha) return 'missing';
  if (now > captcha.expires) return 'expired';
  return Number(String(input).trim()) === captcha.answer ? 'ok' : 'wrong';
}

export function recentFails(times = [], now = Date.now()) {
  return times.filter(t => now - t < FAIL_WINDOW);
}

export function accountTooNew(createdAt, minDays, now = Date.now()) {
  return minDays > 0 && now - createdAt < minDays * DAY;
}

function record(guildId, userId, result) {
  db.prepare('INSERT INTO verifications (guild_id, user_id, result, created_at) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, result, Date.now());
}

function verifiedRole(guild) {
  const id = getSetting(guild.id, 'verified_role');
  return id ? guild.roles.cache.get(id) : null;
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  new SlashCommandBuilder().setName('verify').setDescription('Verification system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('panel').setDescription('Post the verification panel')
      .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText))),
];

export async function onCommand(i) {
  const role = verifiedRole(i.guild);
  if (!role) return i.reply(ephemeral('Set a verified role first with `/setup role`.'));
  if (!role.editable) return i.reply(ephemeral(`I can't give ${role}. Move my role above it and give me Manage Roles.`));

  const channel = i.options.getChannel('channel') ?? i.channel;
  await channel.send({
    embeds: [{
      title: 'Verification',
      description: 'Press the button below and answer a short question to get access to the server.',
      color: colors.brand,
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:start').setLabel('Verify').setStyle(ButtonStyle.Success),
    )],
  });
  await i.reply(ephemeral(`Verification panel posted in ${channel}.`));
}

export async function onComponent(i, action) {
  const key = `${i.guildId}:${i.user.id}`;
  const role = verifiedRole(i.guild);
  if (!role) return i.reply(ephemeral('Verification is not set up on this server yet.'));
  if (i.member.roles.cache.has(role.id)) return i.reply(ephemeral('You are already verified.'));

  const failTimes = recentFails(fails.get(key));
  if (failTimes.length >= MAX_FAILS) {
    const minutes = Math.ceil((failTimes[0] + FAIL_WINDOW - Date.now()) / 60_000);
    return i.reply(ephemeral(`Too many wrong answers. Try again in ${minutes} minute(s).`));
  }

  if (action === 'start') {
    const minDays = Number(getSetting(i.guildId, 'verify_min_age_days') ?? 0);
    if (accountTooNew(i.user.createdTimestamp, minDays)) {
      record(i.guildId, i.user.id, 'too_new');
      await sendLog(i.guild, { title: 'Verification refused', color: colors.warn, description: `${i.user} account is younger than ${minDays} day(s).` });
      return i.reply(ephemeral(`Your account must be at least ${minDays} day(s) old to verify.`));
    }
    const captcha = newCaptcha();
    pending.set(key, captcha);
    return i.showModal(new ModalBuilder().setCustomId('verify:answer').setTitle('Verification').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('answer').setLabel(captcha.question).setStyle(TextInputStyle.Short).setMaxLength(4).setRequired(true),
      ),
    ));
  }

  if (action === 'answer') {
    const result = checkAnswer(pending.get(key), i.fields.getTextInputValue('answer'));
    if (result === 'missing' || result === 'expired') {
      pending.delete(key);
      return i.reply(ephemeral('That question expired. Press Verify again.'));
    }
    pending.delete(key);
    record(i.guildId, i.user.id, result === 'ok' ? 'pass' : 'fail');

    if (result === 'wrong') {
      failTimes.push(Date.now());
      fails.set(key, failTimes);
      const locked = failTimes.length >= MAX_FAILS;
      await sendLog(i.guild, {
        title: locked ? 'Verification locked' : 'Verification failed',
        color: locked ? colors.error : colors.warn,
        description: `${i.user} gave a wrong answer (${failTimes.length}/${MAX_FAILS}).`,
      });
      return i.reply(ephemeral(locked ? 'Wrong answer. You are locked out for 10 minutes.' : 'Wrong answer. Press Verify to try again.'));
    }

    if (!role.editable) return i.reply(ephemeral('I am missing permission to give the verified role. Please tell a staff member.'));
    await i.member.roles.add(role, 'Passed verification');
    fails.delete(key);
    await sendLog(i.guild, { title: 'Member verified', color: colors.ok, description: `${i.user} passed verification.` });
    return i.reply(ephemeral('You are verified. Welcome!'));
  }
}

export async function tick() {
  const now = Date.now();
  for (const [key, c] of pending) if (now > c.expires) pending.delete(key);
  for (const [key, t] of fails) if (!recentFails(t, now).length) fails.delete(key);
}
