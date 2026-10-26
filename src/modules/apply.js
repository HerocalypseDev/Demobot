import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { db, getSetting, setSetting } from '../db.js';
import { colors, isStaff, sendLog } from '../util.js';
import { card, time, userAuthor } from '../ui.js';

export const name = 'apply';

// A modal holds at most 5 inputs, and an input label at most 45 characters.
export function parseQuestions(text) {
  const questions = text.split('|').map(q => q.trim()).filter(Boolean);
  if (!questions.length || questions.length > 5) return { error: 'Give 1 to 5 questions separated by |.' };
  const long = questions.find(q => q.length > 45);
  if (long) return { error: `This question is longer than 45 characters: ${long}` };
  return { questions };
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

// Answers are stored as [question, answer] pairs. Older rows hold only answers, so pair them with the current questions.
const pairsOf = (a, questions) => JSON.parse(a.answers).map((x, n) => (typeof x === 'string' ? [questions[n] ?? `Question ${n + 1}`, x] : x));

function reviewMessage(a, questions, client) {
  const done = a.status !== 'pending';
  const label = a.status[0].toUpperCase() + a.status.slice(1);
  return card({
    accent: a.status === 'accepted' ? colors.ok : a.status === 'denied' ? colors.error : colors.brand,
    title: `Application #${a.id}`,
    body: `From <@${a.user_id}>\n-# Submitted ${time(a.created_at)}`,
    thumbnail: client.users.cache.get(a.user_id)?.displayAvatarURL({ size: 128 }),
    blocks: pairsOf(a, questions).map(([q, answer]) => `**${q}**\n${answer.split('\n').map(line => `> ${line}`).join('\n')}`),
    footer: done ? `${label} by <@${a.reviewer_id}>` : 'Pending review',
    rows: done ? [] : [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`apply:accept:${a.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`apply:deny:${a.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    )],
  });
}

export const commands = [
  new SlashCommandBuilder().setName('apply').setDescription('Application forms')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('setup').setDescription('Set the questions')
      .addStringOption(o => o.setName('questions').setDescription('Up to 5 questions separated by |').setRequired(true).setMaxLength(300))
      .addRoleOption(o => o.setName('role').setDescription('Role given when an application is accepted')))
    .addSubcommand(s => s.setName('panel').setDescription('Post the Apply button')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setMaxLength(100))
      .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText))),
];

export async function onCommand(i) {
  if (i.options.getSubcommand() === 'setup') {
    const { questions, error } = parseQuestions(i.options.getString('questions'));
    if (error) return i.reply(ephemeral(error));
    const role = i.options.getRole('role');
    if (role && !role.editable) return i.reply(ephemeral(`I can't give ${role}. Move my role above it.`));
    setSetting(i.guildId, 'application_questions', JSON.stringify(questions));
    setSetting(i.guildId, 'application_role', role?.id ?? null);
    return i.reply(ephemeral(`Saved ${questions.length} question(s)${role ? `. Accepted applicants get ${role}` : ''}. Post the form with \`/apply panel\`.`));
  }

  if (!getSetting(i.guildId, 'application_questions')) return i.reply(ephemeral('Set the questions first with `/apply setup`.'));
  if (!getSetting(i.guildId, 'application_channel')) return i.reply(ephemeral('Set a review channel first with `/setup channel`.'));
  const channel = i.options.getChannel('channel') ?? i.channel;
  const questions = JSON.parse(getSetting(i.guildId, 'application_questions'));
  await channel.send(card({
    banner: 'applications',
    title: i.options.getString('title') ?? 'Join the team',
    body: 'Press **Apply** to fill in a short form. Staff review every application.',
    blocks: [`**What we ask**\n${questions.map((q, n) => `${n + 1}. ${q}`).join('\n')}`],
    footer: 'Only staff can see your answers. You get a DM with the result.',
    rows: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('apply:start').setLabel('Apply').setStyle(ButtonStyle.Primary))],
  }));
  await i.reply(ephemeral(`Application panel posted in ${channel}.`));
}

export async function onComponent(i, action, [id]) {
  const questions = JSON.parse(getSetting(i.guildId, 'application_questions') ?? '[]');

  if (action === 'start' || action === 'submit') {
    if (!questions.length) return i.reply(ephemeral('Applications are closed.'));
    const pending = db.prepare("SELECT id FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'").get(i.guildId, i.user.id);
    if (pending) return i.reply(ephemeral('You already have an application waiting for review.'));
  }

  if (action === 'start') {
    return i.showModal(new ModalBuilder().setCustomId('apply:submit').setTitle('Application').addComponents(questions.map((q, n) =>
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${n}`).setLabel(q)
        .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)))));
  }

  if (action === 'submit') {
    const channel = i.guild.channels.cache.get(getSetting(i.guildId, 'application_channel'));
    if (!channel) return i.reply(ephemeral('Applications are not set up correctly. Please tell a staff member.'));
    const answers = questions.map((q, n) => [q, i.fields.getTextInputValue(`q${n}`)]);
    const a = db.prepare('INSERT INTO applications (guild_id, user_id, answers, created_at) VALUES (?, ?, ?, ?) RETURNING *')
      .get(i.guildId, i.user.id, JSON.stringify(answers), Date.now());
    await channel.send(reviewMessage(a, questions, i.client));
    return i.reply(ephemeral('Your application was sent. You will get a DM when staff review it.'));
  }

  if (action === 'accept' || action === 'deny') {
    if (!isStaff(i.member)) return i.reply(ephemeral('Only staff can review applications.'));
    const status = action === 'accept' ? 'accepted' : 'denied';
    const changed = db.prepare("UPDATE applications SET status = ?, reviewer_id = ? WHERE id = ? AND status = 'pending'").run(status, i.user.id, Number(id)).changes;
    if (!changed) return i.reply(ephemeral('This application was already reviewed.'));
    const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(id));
    await i.update(reviewMessage(a, questions, i.client));

    let roleNote = '';
    const role = status === 'accepted' && i.guild.roles.cache.get(getSetting(i.guildId, 'application_role'));
    const member = role && await i.guild.members.fetch(a.user_id).catch(() => null);
    if (role && member && role.editable) {
      await member.roles.add(role, `Application #${a.id} accepted`);
      roleNote = ` You now have the ${role.name} role.`;
    }
    const accent = status === 'accepted' ? colors.ok : colors.error;
    await i.client.users.send(a.user_id, card({
      accent,
      title: `Application ${status}`,
      body: `Your application in **${i.guild.name}** was ${status}.${roleNote}`,
      thumbnail: i.guild.iconURL({ size: 128 }) ?? undefined,
    })).catch(() => {});
    const applicant = i.client.users.cache.get(a.user_id);
    await sendLog(i.guild, {
      author: applicant ? userAuthor(applicant) : undefined,
      title: `Application #${a.id} ${status}`,
      color: accent,
      description: `<@${a.user_id}> reviewed by ${i.user}.`,
    });
  }
}
