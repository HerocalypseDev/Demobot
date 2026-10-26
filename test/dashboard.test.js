import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { formatDuration } from '../src/util.js';
import { ticketStats, verifyStats } from '../src/modules/dashboard.js';

const DAY = 86_400_000;
const now = 100 * DAY + 3_600_000;

test('formatDuration', () => {
  assert.equal(formatDuration(null), 'n/a');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(12 * 60_000), '12m');
  assert.equal(formatDuration(65 * 60_000), '1h 5m');
  assert.equal(formatDuration(DAY + 2 * 3_600_000), '1d 2h');
});

test('ticket stats', () => {
  const add = db.prepare(`INSERT INTO tickets (guild_id, number, opener_id, category, opened_at, claimed_at, closed_at, rating, last_activity)
    VALUES ('g', ?, 'u', 'general', ?, ?, ?, ?, 0)`);
  add.run(1, now - DAY, now - DAY + 600_000, null, null);
  add.run(2, now - 2 * DAY, now - 2 * DAY + 1_200_000, now - DAY, 4);
  add.run(3, now - 30 * DAY, null, now - 29 * DAY, 2);
  const s = ticketStats('g', now);
  assert.equal(s.open, 1);
  assert.equal(s.opened, 2);
  assert.equal(s.closed, 1);
  assert.equal(s.avgClaim, 900_000);
  assert.equal(s.avgRating, 3);
  assert.equal(s.ratings, 2);
  assert.equal(ticketStats('empty', now).open, 0);
});

test('verification stats', () => {
  const add = db.prepare("INSERT INTO verifications (guild_id, user_id, result, created_at) VALUES ('g', 'u', ?, ?)");
  add.run('pass', now - 60_000);
  add.run('pass', now - 2 * DAY);
  add.run('fail', now - DAY);
  add.run('too_new', now - DAY);
  add.run('pass', now - 10 * DAY);
  const v = verifyStats('g', now);
  assert.deepEqual({ ...v }, { pass: 2, fail: 1, tooNew: 1, passToday: 1 });
});
