import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicket, openTicketOf, markClosed, autoCloseStage, channelName, escapeHtml, renderTranscript, plainText } from '../src/modules/tickets.js';

test('ticket numbers count up per server and one open ticket per user', () => {
  const a = createTicket('g1', 'u1', 'general', 'help');
  const b = createTicket('g1', 'u2', 'report', 'help');
  const c = createTicket('g2', 'u1', 'other', 'help');
  assert.deepEqual([a.number, b.number, c.number], [1, 2, 1]);
  assert.equal(openTicketOf('g1', 'u1').id, a.id);
  assert.equal(markClosed(a.id, 'u1'), true);
  assert.equal(markClosed(a.id, 'u1'), false);
  assert.equal(openTicketOf('g1', 'u1'), undefined);
  assert.equal(createTicket('g1', 'u1', 'general', 'again').number, 3);
});

test('auto close warns at 47h idle, closes 1h after the warning', () => {
  const h = 3_600_000;
  assert.equal(autoCloseStage({ last_activity: 0 }, 46 * h), null);
  assert.equal(autoCloseStage({ last_activity: 0 }, 47 * h), 'warn');
  assert.equal(autoCloseStage({ last_activity: 0, warned_at: 47 * h }, 47.5 * h), null);
  assert.equal(autoCloseStage({ last_activity: 0, warned_at: 47 * h }, 48 * h), 'close');
});

test('channel names', () => {
  assert.equal(channelName(7), 'ticket-0007');
  assert.equal(channelName(12, 'high'), 'high-0012');
});

test('transcript turns markdown and mentions into plain text', () => {
  const names = { '1': 'sam', '2': 'Staff', '3': 'general' };
  const text = '## Ticket #1\n-# <@1> <@&2>\n**Opened** <t:0:R> in <#3>\n> quoted\nkeep ## this and 2 * 3';
  assert.equal(plainText(text, (kind, id) => names[id]),
    'Ticket #1\n@sam @Staff\nOpened 1970-01-01 00:00 UTC in #general\nquoted\nkeep ## this and 2 * 3');
  assert.equal(plainText('<@9>'), '@9');
});

test('transcript escapes user content', () => {
  assert.equal(escapeHtml(`<script>"x" & 'y'</script>`), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  const html = renderTranscript({ title: '<T>', details: [['Server', '<s>srv</s>']] }, [{
    author: '<b>me</b>', avatar: 'https://cdn.example/a.png" onerror="alert(1)', bot: true, time: 'now',
    content: '<img src=x onerror=alert(1)>', attachments: ['https://cdn.example/a.png?x="1"'],
  }]);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>me</b>'));
  assert.ok(!html.includes('<s>srv</s>'));
  assert.ok(!html.includes('<T>'));
  assert.ok(html.includes('src="https://cdn.example/a.png&quot; onerror=&quot;alert(1)"'));
  assert.ok(html.includes('href="https://cdn.example/a.png?x=&quot;1&quot;"'));
  assert.ok(html.includes('<span class="bot">BOT</span>'));
});
