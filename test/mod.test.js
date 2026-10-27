import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/util.js';
import { addCase, moderationProblem } from '../src/modules/mod.js';
import { parseKeywords } from '../src/modules/automod.js';

test('parseDuration', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1h 30m'), 5_400_000);
  assert.equal(parseDuration('2D'), 172_800_000);
  assert.equal(parseDuration('1w'), 604_800_000);
  for (const bad of ['', '10', 'm', '5x', '-5m', '0m', '1.5h', '10m abc']) assert.equal(parseDuration(bad), null, bad);
});

test('case numbers count up per server', () => {
  assert.equal(addCase('g1', 'u', 'm', 'warn', 'r'), 1);
  assert.equal(addCase('g1', 'u', 'm', 'kick', 'r'), 2);
  assert.equal(addCase('g2', 'u', 'm', 'warn', 'r'), 1);
});

test('moderator hierarchy', () => {
  const guild = { ownerId: 'owner' };
  const m = (id, pos) => ({ id, guild, roles: { highest: { position: pos } } });
  assert.equal(moderationProblem(m('a', 5), m('a', 5)), "You can't moderate yourself.");
  assert.equal(moderationProblem(m('a', 9), m('owner', 1)), "You can't moderate the server owner.");
  assert.equal(moderationProblem(m('a', 5), m('b', 5)), 'Their highest role is not below yours.');
  assert.equal(moderationProblem(m('a', 5), m('b', 4)), null);
  assert.equal(moderationProblem(m('owner', 1), m('b', 9)), null);
  assert.equal(moderationProblem(m('a', 9), { ...m('bot', 1), client: { user: { id: 'bot' } } }), "You can't moderate me.");
});

test('automod keywords', () => {
  assert.deepEqual(parseKeywords(' Spam, scam ,, spam,' + 'x'.repeat(61)), ['spam', 'scam']);
  assert.deepEqual(parseKeywords(''), []);
});
