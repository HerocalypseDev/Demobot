import { AttachmentBuilder, ContainerBuilder, MessageFlags, SeparatorSpacingSize } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { colors } from './util.js';

const bannerPath = name => fileURLToPath(new URL(`../assets/banners/${name}.png`, import.meta.url));

/**
 * One Components V2 card. Order: banner, title + body (with optional thumbnail),
 * then each block after a divider, then subtext footer, then buttons/selects.
 * Mentions never ping unless the caller passes its own allowedMentions.
 */
export function card({ accent = colors.brand, banner, image, title, body, thumbnail, blocks = [], footer, file, rows = [], files = [], ephemeral = false }) {
  const c = new ContainerBuilder().setAccentColor(accent);
  const attachments = [...files];
  if (banner) {
    attachments.push(new AttachmentBuilder(bannerPath(banner), { name: `${banner}.png` }));
    c.addMediaGalleryComponents(g => g.addItems(item => item.setURL(`attachment://${banner}.png`)));
  } else if (image) {
    c.addMediaGalleryComponents(g => g.addItems(item => item.setURL(image)));
  }
  const head = [title && `## ${title}`, body].filter(Boolean).join('\n');
  if (head && thumbnail) {
    c.addSectionComponents(s => s.addTextDisplayComponents(t => t.setContent(head)).setThumbnailAccessory(t => t.setURL(thumbnail)));
  } else if (head) {
    c.addTextDisplayComponents(t => t.setContent(head));
  }
  for (const block of blocks.filter(Boolean)) {
    c.addSeparatorComponents(s => s.setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(t => t.setContent(block));
  }
  if (file) c.addFileComponents(f => f.setURL(`attachment://${file}`));
  if (footer) {
    c.addSeparatorComponents(s => s.setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(t => t.setContent(footer.split('\n').map(line => `-# ${line}`).join('\n')));
  }
  if (rows.length) c.addActionRowComponents(...rows);
  return {
    components: [c],
    files: attachments,
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

// Text progress bar for votes and rates. NaN (no data yet) shows as empty.
export function bar(ratio, width = 10) {
  const r = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const filled = Math.round(r * width);
  return `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\` ${Math.round(r * 100)}%`;
}

export const userAuthor = user => ({ name: user.username, icon_url: user.displayAvatarURL({ size: 64 }) });

// Clickable command mention when the command ID is known, plain text otherwise.
export const cmd = (client, name) => {
  const id = client.commandIds?.get(name.split(' ')[0]);
  return id ? `</${name}:${id}>` : `\`/${name}\``;
};

export const time = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
