import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupCache } from './groupCache.ts';
import { summarizeGroup } from '../types/api.ts';
import { getPlayerLabel, getStandings } from '../domain/groups.ts';
import { DataError } from './groupsApi.ts';

const group = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Synthetic group', avatar: 'paddles', currency: 'none',
  ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', ownerName: 'Synthetic owner',
  revision: '0000000000000001', canEdit: true, canManage: true, isPublic: false,
  players: [], games: [], nextGameNumber: 1, isOwner: true, adminIds: [],
};
const newer = { ...group, name: 'New name', revision: '0000000000000002' };

test('completed-game activity updates on saves and deletion, and stale summaries cannot restore the removed latest date', () => {
  const cache = new GroupCache();
  const first = { status: 'completed', completedAt: '2026-10-26T14:00:00.000Z' };
  const latest = { status: 'completed', completedAt: '2026-10-27T14:00:00.000Z' };
  cache.save({ ...group, games: [first] });
  assert.equal(cache.summaries[0].latestCompletedAt, first.completedAt);
  const completed = { ...newer, games: [first, latest] };
  cache.save(completed);
  assert.equal(cache.summaries[0].latestCompletedAt, latest.completedAt);
  const started = cache.beginLoad();
  cache.save({ ...completed, revision: '0000000000000003', games: [first, { status: 'pending', createdAt: '2026-10-28T14:00:00.000Z' }] });
  cache.applySummaries([summarizeGroup(completed)], started);
  assert.equal(cache.summaries[0].latestCompletedAt, first.completedAt);
  assert.equal(cache.summaries[0].completedGameCount, 1);
  cache.save({ ...group, revision: '0000000000000004', games: [] });
  assert.equal(cache.summaries[0].latestCompletedAt, null);
  assert.equal(cache.summaries[0].completedGameCount, 0);
});

test('profile updates and late legacy snapshots retain authoritative codes without changing IDs or revisions', () => {
  const cache = new GroupCache();
  const player = { id: group.ownerId, name: group.ownerName, avatar: 'smile' };
  cache.save({ ...group, players: [player] });
  const old = cache.beginLoad();
  cache.updatePlayerProfile({ ...player, name: 'Updated name', code: 'K7M2Q9' });
  cache.acceptGroup({ ...group, players: [player] }, old);
  assert.equal(cache.groups[0].players[0].code, 'K7M2Q9');
  assert.equal(cache.groups[0].players[0].name, 'Updated name');
  assert.equal(cache.groups[0].players[0].id, player.id);
  assert.equal(cache.groups[0].revision, group.revision);
  cache.acceptGroup({ ...group, players: [{ ...player, code: 'K7M2Q9', name: 'Other device' }] }, cache.beginLoad());
  assert.equal(cache.groups[0].players[0].name, 'Other device');
  assert.equal(cache.groups[0].players[0].code, 'K7M2Q9');
});

test('startup summaries have no fabricated details or statistics, including empty lists', () => {
  for (const incoming of [[], [group]]) {
    const cache = new GroupCache();
    cache.applySummaries(incoming.map(summarizeGroup), cache.beginLoad());
    assert.deepEqual(cache.summaries, incoming.map(summarizeGroup));
    assert.deepEqual(cache.groups, []);
    assert.equal(cache.statsReady, false);
    cache.applyGroups(incoming, cache.beginLoad());
    assert.deepEqual(cache.groups, incoming);
    assert.equal(cache.statsReady, true);
  }
});

test('summary counts include all roster entries and only completed games', () => {
  const summary = summarizeGroup({ ...group,
    players: [{ id: 'registered' }, { id: 'guest', isGuest: true }, { id: 'anonymous', isDeleted: true }],
    games: [{ status: 'pending' }, { status: 'completed' }, { status: 'completed' }],
  });
  assert.equal(summary.playerCount, 3);
  assert.equal(summary.completedGameCount, 2);
  for (const key of ['players', 'games', 'nextGameNumber']) assert.equal(key in summary, false);
});

test('opening one group loads just that detail and leaves aggregate statistics unready', () => {
  const second = { ...group, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' };
  const cache = new GroupCache();
  cache.applySummaries([group, second].map(summarizeGroup), cache.beginLoad());
  assert.equal(cache.acceptGroup(group, cache.beginLoad()), true);
  assert.deepEqual(cache.groups, [group]);
  assert.equal(cache.statsReady, false);
});

test('newer saves and newly created groups survive in-flight list snapshots', () => {
  const cache = new GroupCache();
  cache.save(group);
  const started = cache.beginLoad();
  cache.save(newer);
  const created = { ...group, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' };
  cache.save(created);
  cache.applyGroups([group], started);
  assert.deepEqual(cache.groups, [newer, created]);
  assert.deepEqual(cache.summaries, [newer, created].map(summarizeGroup));
  assert.equal(cache.statsReady, true);
});

test('departures win over late lists, late detail loads and stale save callbacks', () => {
  const cache = new GroupCache();
  cache.save(group);
  const list = cache.beginLoad();
  const detail = cache.beginLoad();
  cache.remove(group.id);
  cache.applyGroups([newer], list);
  assert.equal(cache.acceptGroup(newer, detail), false);
  assert.equal(cache.save(newer), false);
  assert.deepEqual(cache.groups, []);
  assert.deepEqual(cache.summaries, []);
  assert.equal(cache.acceptGroup({ ...newer, canManage: false, isOwner: false }, cache.beginLoad()), true);
  assert.equal(cache.summaries[0].canManage, false);
});

test('authoritative list removal invalidates pending details and may restore a later rejoin', () => {
  const cache = new GroupCache();
  cache.save(group);
  const detail = cache.beginLoad();
  cache.applySummaries([], cache.beginLoad());
  assert.equal(cache.acceptGroup(newer, detail), false);
  cache.applySummaries([summarizeGroup(newer)], cache.beginLoad());
  assert.deepEqual(cache.summaries, [summarizeGroup(newer)]);
  assert.deepEqual(cache.groups, []);
});

test('older overlapping summary/statistics responses cannot replace the newer list', () => {
  const cache = new GroupCache();
  cache.save(group);
  const oldSummary = cache.beginLoad();
  const oldStats = cache.beginLoad();
  cache.applySummaries([], cache.beginLoad());
  assert.equal(cache.applySummaries([summarizeGroup(group)], oldSummary), false);
  assert.equal(cache.applyGroups([group], oldStats), false);
  assert.deepEqual(cache.groups, []);
  assert.deepEqual(cache.summaries, []);
});

test('new revisions invalidate statistics until matching details arrive; old responses cannot roll back scores', () => {
  const cache = new GroupCache();
  cache.applyGroups([group], cache.beginLoad());
  cache.applySummaries([summarizeGroup(newer)], cache.beginLoad());
  assert.equal(cache.statsReady, false);
  assert.equal(cache.acceptGroup(group, cache.beginLoad()), false);
  assert.equal(cache.acceptGroup(newer, cache.beginLoad()), true);
  assert.equal(cache.statsReady, true);
  assert.equal(cache.acceptGroup(group, cache.beginLoad()), true, 'An already cached newer detail remains safe to open.');
  assert.deepEqual(cache.groups, [newer]);
  cache.applyGroups([group], cache.beginLoad());
  assert.deepEqual(cache.groups, [newer]);
  assert.equal(cache.statsReady, true);
});

test('separate account caches never inherit summaries, details or deletion tombstones', () => {
  const first = new GroupCache();
  first.save(group);
  first.remove(group.id);
  const second = new GroupCache();
  assert.deepEqual(second.summaries, []);
  assert.deepEqual(second.groups, []);
  assert.equal(second.acceptGroup(group, second.beginLoad()), true);
  assert.equal(first.save(group), false);
});

const profile = { id: group.ownerId, name: 'Updated player', avatar: 'fox' };
const roster = {
  ...group,
  players: [
    { id: group.ownerId, name: group.ownerName, avatar: 'smile' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', name: profile.name, avatar: 'panda' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', name: 'Synthetic Casey', avatar: 'smile' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', name: 'Synthetic Drew', avatar: 'smile' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', name: 'Visitor', avatar: 'smile', isGuest: true },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', name: 'Deleted player', avatar: 'smile', isDeleted: true },
  ],
  games: [{
    id: 'game-1', status: 'completed', wagerUnits: 0, scoreA: 11, scoreB: 7,
    teamA: [group.ownerId, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'],
    teamB: ['aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004'],
  }],
  nextGameNumber: 2,
};

test('confirmed profiles update every cached roster and owner summary without changing results or identities', () => {
  const cache = new GroupCache();
  const second = { ...roster, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' };
  const unloaded = { ...group, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003' };
  cache.applyGroups([roster, second], cache.beginLoad());
  cache.applySummaries([roster, second, unloaded].map(summarizeGroup), cache.beginLoad());
  const before = JSON.stringify(roster);
  cache.updatePlayerProfile(profile);
  assert.equal(cache.statsReady, false, 'A profile update cannot fabricate unloaded group details.');
  assert.equal(cache.groups.length, 2);
  assert.ok(cache.summaries.every(summary => summary.ownerName === profile.name));
  for (const updated of cache.groups) {
    assert.deepEqual(updated.players[0], profile);
    assert.deepEqual(updated.players.slice(1), roster.players.slice(1));
    assert.equal(updated.games, roster.games);
    assert.equal(updated.revision, roster.revision);
    assert.equal(updated.nextGameNumber, roster.nextGameNumber);
    assert.deepEqual(updated.adminIds, roster.adminIds);
    assert.match(getPlayerLabel(updated, updated.players[0]), new RegExp(profile.id));
    const results = g => getStandings(g).map(({ player, wins, losses, rank, pointDifferential, netUnits }) =>
      ({ playerId: player.id, wins, losses, rank, pointDifferential, netUnits })).sort((a, b) => a.playerId.localeCompare(b.playerId));
    assert.deepEqual(results(updated), results(roster));
  }
  assert.equal(JSON.stringify(roster), before);
});

test('late summary, full-list, detail and mutation responses cannot undo a confirmed name or avatar', () => {
  const cache = new GroupCache();
  cache.applyGroups([roster], cache.beginLoad());
  const started = cache.beginLoad();
  cache.updatePlayerProfile(profile);
  cache.applySummaries([summarizeGroup(roster)], started);
  cache.applyGroups([roster], started);
  assert.equal(cache.acceptGroup(roster, started), true);
  const changedGame = { ...roster.games[0], scoreB: 8 };
  cache.save({ ...roster, revision: newer.revision, games: [changedGame] });
  const updated = cache.groups[0];
  assert.equal(updated.ownerName, profile.name);
  assert.deepEqual(updated.players[0], profile);
  assert.deepEqual(updated.games, [changedGame], 'Profile protection must not roll back a newer result.');
  assert.equal(updated.revision, newer.revision);
  assert.equal(cache.statsReady, true);
});

test('fresh reads accept profile changes from other devices and protect them against older reads', () => {
  for (const load of ['detail', 'list']) {
    const cache = new GroupCache();
    cache.save(roster);
    cache.updatePlayerProfile(profile);
    const late = cache.beginLoad(), fresh = cache.beginLoad();
    const otherDevice = { ...profile, name: 'Another device name', avatar: 'tiger' };
    const incoming = { ...roster, ownerName: otherDevice.name, players: [otherDevice, ...roster.players.slice(1)] };
    if (load === 'detail') cache.acceptGroup(incoming, fresh);
    else cache.applyGroups([incoming], fresh);
    cache.acceptGroup(roster, late);
    assert.deepEqual(cache.groups[0].players[0], otherDevice);
    assert.equal(cache.summaries[0].ownerName, otherDevice.name);
    cache.save({ ...roster, revision: newer.revision });
    assert.deepEqual(cache.groups[0].players[0], otherDevice);
  }
});

test('profile updates preserve unloaded summaries, non-owner labels and account isolation without restoring departures', () => {
  const cache = new GroupCache();
  const memberGroup = { ...roster, ownerId: roster.players[1].id, ownerName: roster.players[1].name };
  cache.save(memberGroup);
  cache.updatePlayerProfile(profile);
  assert.equal(cache.groups[0].ownerName, memberGroup.ownerName);
  assert.deepEqual(cache.groups[0].players[0], profile);
  cache.remove(memberGroup.id);
  cache.updatePlayerProfile({ ...profile, name: 'Changed again' });
  assert.deepEqual(cache.groups, []);
  assert.deepEqual(cache.summaries, []);
  const otherAccount = new GroupCache();
  otherAccount.save(memberGroup);
  assert.deepEqual(otherAccount.groups[0], memberGroup);
  for (const invalid of [{ ...profile, isGuest: true }, { ...profile, isDeleted: true }, { ...profile, name: ' ' }]) {
    assert.throws(() => otherAccount.updatePlayerProfile(invalid), DataError);
  }
  assert.deepEqual(otherAccount.groups[0], memberGroup);
});

test('a later owner-name summary does not mask an avatar from an earlier detail refresh', () => {
  const cache = new GroupCache();
  cache.save(roster);
  cache.updatePlayerProfile(profile);
  const detail = cache.beginLoad(), summary = cache.beginLoad();
  cache.applySummaries([{ ...summarizeGroup(roster), ownerName: 'Latest owner name' }], summary);
  cache.acceptGroup({ ...roster, players: [{ ...profile, avatar: 'tiger' }, ...roster.players.slice(1)] }, detail);
  assert.equal(cache.groups[0].ownerName, 'Latest owner name');
  assert.equal(cache.groups[0].players[0].name, 'Latest owner name');
  assert.equal(cache.groups[0].players[0].avatar, 'tiger');
});
