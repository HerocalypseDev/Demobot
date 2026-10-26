import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinners } from '../src/modules/giveaway.js';
import { castVote, voteCounts } from '../src/modules/suggest.js';

test('giveaway winners are unique and never more than entries', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  for (let n = 0; n < 50; n++) {
    const w = pickWinners(pool, 3);
    assert.equal(w.length, 3);
    assert.equal(new Set(w).size, 3);
    assert.ok(w.every(x => pool.includes(x)));
  }
  assert.equal(pickWinners(pool, 10).length, 5);
  assert.deepEqual(pickWinners([], 2), []);
  assert.deepEqual(pool, ['a', 'b', 'c', 'd', 'e']);
});

test('suggestion votes toggle and switch', () => {
  assert.deepEqual({ ...voteCounts(1) }, { up: 0, down: 0 });
  assert.equal(castVote(1, 'u1', 1), 1);
  assert.equal(castVote(1, 'u2', 1), 1);
  assert.equal(castVote(1, 'u1', -1), -1);
  assert.deepEqual({ ...voteCounts(1) }, { up: 1, down: 1 });
  assert.equal(castVote(1, 'u2', 1), 0);
  assert.deepEqual({ ...voteCounts(1) }, { up: 0, down: 1 });
});
