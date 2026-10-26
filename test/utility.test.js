import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedInput } from '../src/modules/embed.js';
import { parseQuestions } from '../src/modules/apply.js';

test('embed input validation', () => {
  const ok = parseEmbedInput({ title: 'T', description: 'D', color: '#00ff00', image: 'https://example.com/a.png', footer: 'F' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.embed.color, 0x00ff00);
  assert.equal(ok.embed.image.url, 'https://example.com/a.png');
  assert.equal(parseEmbedInput({ description: 'D', color: 'ABCDEF' }).embed.color, 0xabcdef);

  const bad = parseEmbedInput({ description: 'D', color: 'red', image: 'javascript:alert(1)' });
  assert.equal(bad.errors.length, 2);
  assert.equal(parseEmbedInput({ description: 'D', image: 'http://example.com/a.png' }).errors.length, 1);
});

test('application questions', () => {
  assert.deepEqual(parseQuestions(' Age? | Why join? |'), { questions: ['Age?', 'Why join?'] });
  assert.ok(parseQuestions('a|b|c|d|e|f').error);
  assert.ok(parseQuestions(' | ').error);
  assert.ok(parseQuestions('x'.repeat(46)).error);
});
