import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { colors } from '../util.js';

export const name = 'embed';

// Turns raw modal input into an embed, or a list of problems to show the user.
export function parseEmbedInput({ title, description, color, image, footer }) {
  const errors = [];
  const embed = { description, color: colors.brand };
  if (title) embed.title = title;
  if (footer) embed.footer = { text: footer };
  if (color) {
    if (/^#?[0-9a-f]{6}$/i.test(color)) embed.color = parseInt(color.replace('#', ''), 16);
    else errors.push('Color must be a hex code like #8b5e3c.');
  }
  if (image) {
    const url = URL.canParse(image) ? new URL(image) : null;
    if (url?.protocol === 'https:') embed.image = { url: url.href };
    else errors.push('Image must be an https:// link.');
  }
  return { embed, errors };
}

const input = (id, label, style, max, required = false) =>
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required));

export const commands = [
  new SlashCommandBuilder().setName('embed').setDescription('Build and post a custom embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild)
    .addChannelOption(o => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText)),
];

export async function onCommand(i) {
  const channel = i.options.getChannel('channel') ?? i.channel;
  await i.showModal(new ModalBuilder().setCustomId(`embed:build:${channel.id}`).setTitle('Embed builder').addComponents(
    input('title', 'Title', TextInputStyle.Short, 256),
    input('description', 'Description', TextInputStyle.Paragraph, 4000, true),
    input('color', 'Color (hex, for example #8b5e3c)', TextInputStyle.Short, 7),
    input('image', 'Image URL (https)', TextInputStyle.Short, 500),
    input('footer', 'Footer', TextInputStyle.Short, 2048),
  ));
}

export async function onComponent(i, action, [channelId]) {
  if (action === 'cancel') return i.update({ content: 'Cancelled.', embeds: [], components: [] });

  if (action === 'build') {
    const fields = Object.fromEntries(['title', 'description', 'color', 'image', 'footer'].map(k => [k, i.fields.getTextInputValue(k).trim()]));
    const { embed, errors } = parseEmbedInput(fields);
    if (errors.length) return i.reply({ content: `${errors.join('\n')}\nRun \`/embed\` again.`, flags: MessageFlags.Ephemeral });
    return i.reply({
      content: `Preview. Post it in <#${channelId}>?`,
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embed:send:${channelId}`).setLabel('Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('embed:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  if (action === 'send') {
    const channel = i.guild.channels.cache.get(channelId);
    if (!channel?.permissionsFor(i.member).has(PermissionFlagsBits.SendMessages)) {
      return i.update({ content: 'You can\'t post in that channel.', embeds: [], components: [] });
    }
    await channel.send({ embeds: i.message.embeds });
    return i.update({ content: `Embed posted in ${channel}.`, embeds: [], components: [] });
  }
}
