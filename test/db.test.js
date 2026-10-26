import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting, setSetting, getSettings } from '../src/db.js';

test('settings round trip, overwrite and reset', () => {
  assert.equal(getSetting('g1', 'log_channel'), null);
  setSetting('g1', 'log_channel', '111');
  setSetting('g1', 'log_channel', '222');
  setSetting('g2', 'log_channel', '333');
  assert.equal(getSetting('g1', 'log_channel'), '222');
  assert.deepEqual(getSettings('g2'), { log_channel: '333' });
  setSetting('g1', 'log_channel', null);
  assert.equal(getSetting('g1', 'log_channel'), null);
});
