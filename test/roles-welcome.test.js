import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { roleProblem } from '../src/modules/roles.js';
import { fillPlaceholders } from '../src/modules/welcome.js';

const guild = { id: 'g', ownerId: 'owner' };
const role = (over = {}) => ({ id: 'r', guild, managed: false, editable: true, position: 5, permissions: new PermissionsBitField(0n), ...over });
const member = (id, highest) => ({ id, roles: { highest: { position: highest } } });

test('role menu refuses unsafe roles', () => {
  assert.equal(roleProblem(role()), null);
  assert.equal(roleProblem(role({ id: 'g' })), 'is @everyone');
  assert.equal(roleProblem(role({ managed: true })), 'is managed by an integration');
  assert.equal(roleProblem(role({ permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers) })), 'has staff permissions');
  assert.equal(roleProblem(role({ editable: false })), 'is above my highest role');
  assert.equal(roleProblem(role(), member('mod', 5)), 'is not below your highest role');
  assert.equal(roleProblem(role(), member('mod', 6)), null);
  assert.equal(roleProblem(role(), member('owner', 1)), null);
});

test('welcome placeholders', () => {
  const vars = { user: '<@1>', name: 'Sam', server: 'Demo', count: 42 };
  assert.equal(fillPlaceholders('Hi {user} ({name}) in {server}, #{count}. {unknown}', vars), 'Hi <@1> (Sam) in Demo, #42. {unknown}');
});
