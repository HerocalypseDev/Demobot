import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { MessageFlags, ComponentType } from 'discord.js';
import { card, bar } from '../src/ui.js';

test('progress bar', () => {
  assert.equal(bar(0), '`░░░░░░░░░░` 0%');
  assert.equal(bar(1), '`██████████` 100%');
  assert.equal(bar(0.5), '`█████░░░░░` 50%');
  assert.equal(bar(NaN), '`░░░░░░░░░░` 0%');
  assert.equal(bar(2, 4), '`████` 100%');
});

test('card builds a V2 container with banner, blocks and no pings', () => {
  const msg = card({ banner: 'verify', title: 'T', body: 'B', blocks: ['x', null], footer: 'a\nb', accent: 0x123456, ephemeral: true });
  assert.ok(msg.flags & MessageFlags.IsComponentsV2);
  assert.ok(msg.flags & MessageFlags.Ephemeral);
  assert.deepEqual(msg.allowedMentions, { parse: [] });
  assert.equal(msg.files[0].name, 'verify.png');
  const json = msg.components[0].toJSON();
  assert.equal(json.accent_color, 0x123456);
  const [gallery, head, sep, block, sep2, footer] = json.components;
  assert.equal(gallery.type, ComponentType.MediaGallery);
  assert.equal(gallery.items[0].media.url, 'attachment://verify.png');
  assert.equal(head.content, '## T\nB');
  assert.equal(sep.type, ComponentType.Separator);
  assert.equal(block.content, 'x');
  assert.equal(sep2.type, ComponentType.Separator);
  assert.equal(footer.content, '-# a\n-# b');
  assert.equal(json.components.length, 6);
});

test('every banner used in code has an image', () => {
  for (const file of readdirSync('src/modules')) {
    for (const [, name] of readFileSync(`src/modules/${file}`, 'utf8').matchAll(/banner: '(\w+)'/g)) {
      assert.ok(existsSync(`assets/banners/${name}.png`), `${file} uses missing banner ${name}`);
    }
  }
});
