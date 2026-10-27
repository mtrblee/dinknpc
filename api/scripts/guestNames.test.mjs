import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guestNameChanges } from './guestNames.mjs';

test('legacy guest name repair preserves the first guest and avoids all existing names, including suffixes', () => {
  const players = ['Alex', ' alex ', 'Alex (2)', 'ALEX', 'Blair', 'blair', 'Blair (2)', 'Blair (3)']
    .map((name, id) => ({ id, name }));
  const changes = guestNameChanges(players);
  assert.deepEqual(changes, [{ id: 1, name: 'alex (3)' }, { id: 3, name: 'ALEX (4)' }, { id: 5, name: 'blair (4)' }]);
  assert.equal(players[1].name, ' alex ');
  const repaired = players.map((player) => changes.find((entry) => entry.id === player.id) ?? player);
  assert.deepEqual(guestNameChanges(repaired), []);
  assert.deepEqual(guestNameChanges([{ id: 9, name: 'Alex' }]), []);
  assert.throws(() => guestNameChanges([{ id: 1, name: ' ' }]), /empty name/);
});
