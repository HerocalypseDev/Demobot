import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCaptcha, checkAnswer, recentFails, accountTooNew } from '../src/modules/verify.js';

test('captcha answer matches question and expires', () => {
  const c = newCaptcha(0);
  const [a, b] = c.question.match(/\d+/g).map(Number);
  assert.equal(c.answer, a + b);
  assert.equal(checkAnswer(c, ` ${a + b} `, 1000), 'ok');
  assert.equal(checkAnswer(c, String(a + b + 1), 1000), 'wrong');
  assert.equal(checkAnswer(c, 'abc', 1000), 'wrong');
  assert.equal(checkAnswer(c, String(a + b), c.expires + 1), 'expired');
  assert.equal(checkAnswer(undefined, '5'), 'missing');
});

test('only fails inside the 10 minute window count', () => {
  const now = 20 * 60_000;
  assert.deepEqual(recentFails([0, now - 11 * 60_000, now - 60_000, now], now), [now - 60_000, now]);
  assert.deepEqual(recentFails(undefined, now), []);
});

test('account age gate', () => {
  const day = 86_400_000;
  assert.equal(accountTooNew(0, 0, day), false);
  assert.equal(accountTooNew(0, 7, 3 * day), true);
  assert.equal(accountTooNew(0, 7, 8 * day), false);
});
