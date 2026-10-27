import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, getStandings, ValidationError } from './groups.ts';
import { changeGroupAdmin, createOwnedGroup, sortPlayersByRole } from './groupRoles.ts';
import { mayChangeGroup, summarizeGroup } from '../types/api.ts';

const players = Array.from({ length: 5 }, (_, i) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`, name: `Synthetic player ${i + 1}`, avatar: 'smile',
}));

test('rosters show the owner, then admins, then regular players without changing within-role order or input', () => {
  const roster = Object.freeze([players[4], players[1], players[2], players[0], players[3]]);
  const group = Object.freeze({ ownerId: players[0].id, adminIds: Object.freeze([players[3].id, players[1].id]) });
  const before = structuredClone(roster);
  const sorted = sortPlayersByRole(group, roster);
  assert.deepEqual(sorted.map(player => player.id), [players[0], players[1], players[3], players[4], players[2]].map(player => player.id));
  assert.deepEqual(roster, before);
  assert.notEqual(sorted, roster);
  assert.equal(sorted[0], players[0]);
});

test('role ordering retains guests and deleted records in the regular-player section without inventing a missing owner', () => {
  const guest = { ...players[3], isGuest: true }, deleted = { ...players[4], isDeleted: true };
  const roster = [guest, players[2], deleted, players[1]];
  const group = { ownerId: players[0].id, adminIds: [players[1].id] };
  assert.deepEqual(sortPlayersByRole(group, roster), [players[1], guest, players[2], deleted]);
  assert.deepEqual(sortPlayersByRole(group, []), []);
  assert.deepEqual(sortPlayersByRole({ ...group, adminIds: [] }, roster), roster);
  assert.deepEqual(sortPlayersByRole(group, [players[2], players[1]]), [players[1], players[2]]);
});

test('role ordering immediately follows admin changes and ownership transfers, with owner priority over any admin entry', () => {
  const roster = [players[2], players[1], players[0]];
  assert.deepEqual(sortPlayersByRole({ ownerId: players[0].id, adminIds: [players[1].id] }, roster),
    [players[0], players[1], players[2]]);
  assert.deepEqual(sortPlayersByRole({ ownerId: players[0].id, adminIds: [] }, roster),
    [players[0], players[2], players[1]]);
  assert.deepEqual(sortPlayersByRole({ ownerId: players[2].id, adminIds: [players[1].id, players[2].id] }, roster),
    [players[2], players[1], players[0]]);
});

test('new owned groups enroll their creator exactly once without games or ranked results in every currency', () => {
  for (const currency of ['none', 'money', 'boba']) {
    const group = createOwnedGroup([], ' Crew ', players[0], currency, 'trophy');
    assert.equal(group.name, 'Crew');
    assert.deepEqual(group.players, [players[0]]);
    assert.deepEqual(group.games, []);
    assert.equal(group.nextGameNumber, 1);
    assert.equal(group.avatar, 'trophy');
    assert.equal(group.currency, currency);
    assert.deepEqual(getStandings(group).map(row => [row.rank, row.wins, row.losses, row.netUnits]), [[null, 0, 0, 0]]);
    assert.throws(() => createOwnedGroup([group], ' crew ', players[0]), ValidationError);
  }
  for (const owner of [{ ...players[0], isGuest: true }, { ...players[0], isDeleted: true },
    { ...players[0], id: 'invalid' }, { ...players[0], name: ' ' }]) {
    assert.throws(() => createOwnedGroup([], 'Crew', owner), ValidationError);
  }
});

function fixture() {
  let group = createOwnedGroup([], 'Crew', players[0]);
  for (const player of players.slice(1)) group = addPlayer(group, player);
  return { ...group, ownerId: players[0].id, adminIds: [] };
}

test('owner and admins can manage other admins without changing participants, results, or ownership', () => {
  const group = fixture(), before = structuredClone(group);
  const first = changeGroupAdmin(group, players[0].id, players[1].id, true);
  const second = changeGroupAdmin({ ...group, adminIds: first }, players[1].id, players[2].id, true);
  assert.deepEqual(second, players.slice(1, 3).map(player => player.id));
  assert.deepEqual(changeGroupAdmin({ ...group, adminIds: second }, players[2].id, players[1].id, false), [players[2].id]);
  assert.deepEqual(changeGroupAdmin({ ...group, adminIds: first }, players[0].id, players[1].id, false), []);
  assert.deepEqual(changeGroupAdmin({ ...group, adminIds: first }, players[0].id, players[1].id, true), first);
  assert.deepEqual(group, before);
  const legacyOwner = { ...group, players: group.players.filter(player => player.id !== group.ownerId) };
  assert.deepEqual(changeGroupAdmin(legacyOwner, group.ownerId, players[1].id, true), first);
});

test('admin changes reject self changes, owner changes, nonmembers, inactive players, and forged capabilities', () => {
  const group = { ...fixture(), adminIds: [players[1].id] };
  for (const [actor, target, grant] of [
    [players[2].id, players[3].id, true], [players[1].id, players[1].id, false],
    [players[1].id, players[0].id, false], [players[0].id, players[0].id, true],
    [players[0].id, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', true],
    [players[0].id, 'invalid', true], [players[0].id, players[2].id, 'true'],
  ]) assert.throws(() => changeGroupAdmin({ ...group, canManage: true }, actor, target, grant), ValidationError);
  for (const flag of ['isGuest', 'isDeleted']) {
    const inactive = { ...group, players: group.players.map(player => ({ ...player, [flag]: player.id === players[1].id })) };
    assert.throws(() => changeGroupAdmin(inactive, players[1].id, players[2].id, true), ValidationError);
    assert.throws(() => changeGroupAdmin(inactive, players[0].id, players[1].id, true), ValidationError);
  }
});

test('admin management capabilities are distinct from ownership and summaries omit role rosters', () => {
  const admin = { ...fixture(), canEdit: true, canManage: true, isOwner: false, adminIds: [players[1].id] };
  for (const type of ['add-guest', 'remove-player', 'delete-game', 'set-visibility', 'set-avatar', 'set-admin', 'review-request']) {
    assert.equal(mayChangeGroup(admin, { type }), true);
    assert.equal(mayChangeGroup({ ...admin, canManage: false }, { type }), false);
  }
  const summary = summarizeGroup(admin);
  assert.equal(summary.isOwner, false);
  assert.equal(summary.canManage, true);
  assert.equal('adminIds' in summary, false);
  assert.equal('players' in summary, false);
});
