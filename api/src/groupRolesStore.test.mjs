import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { createSqlStore } from './sqlStore.ts';
import { generatePlayerCode } from './playerCodes.ts';
import { PLAYER_CODE_ALPHABET, validatePlayerCode } from '../../src/domain/groups.ts';

const people = Array.from({ length: 5 }, (_, i) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`, name: `Synthetic ${i + 1}`, avatar: 'smile',
  code: `TESTA${'ABCDE'[i]}`,
}));
const fingerprint = '1'.repeat(64);
function fixture(t, seed = false) {
  let row = seed ? { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', owner_id: people[0].id,
    name: 'Synthetic roles', currency: 'none', avatar: 'paddles', is_public: false, counter: '1' } : null;
  let version = 1, inserts = 0;
  const profiles = new Map(people.map(person => [person.id, { ...person }]));
  const codes = new Map(people.map(person => [person.id, person.code]));
  const codeErrors = [];
  const pendingRequests = [];
  const members = new Map(seed ? people.slice(0, 4).map((p, position) => [p.id, {
    player_id: p.id, name_snapshot: p.name, position, is_admin: position === 1,
  }]) : []);
  const receipts = new Map(), queries = [];
  t.mock.method(sql.Transaction.prototype, 'begin', async () => {});
  t.mock.method(sql.Transaction.prototype, 'commit', async () => {});
  t.mock.method(sql.Transaction.prototype, 'rollback', async () => {});
  t.mock.method(sql.Request.prototype, 'query', async function (query) {
    queries.push(query);
    const p = Object.fromEntries(Object.entries(this.parameters).map(([key, value]) => [key, value.value]));
    const result = recordset => ({ recordset });
    if (query.includes('FROM dbo.AccountDeletions') || query.includes('FROM dbo.GroupLifecycleMutations')) return result([]);
    if (query.includes('SELECT is_guest, is_deleted FROM dbo.Players')) {
      const profile = profiles.get(p.id ?? p.actor);
      if (query.includes('UPDATE dbo.Players')) profiles.set(p.id, { ...profile, id: p.id, name: p.name, avatar: p.avatar });
      return result([{ is_guest: profile?.isGuest === true, is_deleted: profile?.isDeleted === true }]);
    }
    if (query.includes('SELECT id FROM dbo.Players WITH')) return result([]);
    if (query.includes('INSERT dbo.PlayerCodes')) {
      if (!codes.has(p.id)) {
        if (codeErrors.length) throw codeErrors.shift();
        codes.set(p.id, p.code);
      }
      return result([{ code: codes.get(p.id) }]);
    }
    if (query.includes('FROM dbo.PlayerCodes c JOIN dbo.Players p')) {
      assert.match(query, /c\.code = @code AND p\.is_guest = 0 AND p\.is_deleted = 0/);
      const id = [...codes].find(([id, code]) => code === p.code && profiles.has(id) && !profiles.get(id).isGuest && !profiles.get(id).isDeleted)?.[0];
      return result(id ? [{ player_id: id }] : []);
    }
    if (query.includes('FROM dbo.Mutations')) return result(receipts.has(`${p.actor}:${p.request}`) ? [receipts.get(`${p.actor}:${p.request}`)] : []);
    if (query.includes('INSERT dbo.Mutations')) {
      receipts.set(`${p.actor}:${p.request}`, { group_id: p.id, fingerprint: p.fingerprint, tournament_id: null }); return result([]);
    }
    if (query.includes('SELECT name FROM dbo.Groups')) return result(row && row.owner_id === p.actor ? [{ name: row.name }] : []);
    if (query.includes('INSERT dbo.Groups')) {
      inserts++;
      row = { id: p.id, owner_id: p.owner, name: p.name, currency: p.currency, avatar: p.avatar, is_public: false, counter: '1' };
      return result([]);
    }
    if (query.includes('FROM dbo.Groups g')) return result(row && row.id === p.id ? [{
      ...row, owner_name: profiles.get(row.owner_id).name, revision: Buffer.from(version.toString(16).padStart(16, '0'), 'hex'),
    }] : []);
    if (query.includes('FROM dbo.GroupMembers m JOIN dbo.Players p')) {
      assert.match(query, /CASE WHEN p\.is_guest = 1 OR p\.is_deleted = 1 THEN m\.name_snapshot ELSE p\.display_name END AS display_name/);
      return result([...members.values()].sort((a, b) => a.position - b.position).map(member => {
        const profile = profiles.get(member.player_id);
        return { ...member, display_name: profile.isGuest || profile.isDeleted ? member.name_snapshot : profile.name,
          code: profile.isGuest || profile.isDeleted ? null : codes.get(member.player_id),
          avatar: profile.avatar, is_guest: profile.isGuest === true, is_deleted: profile.isDeleted === true };
      }));
    }
    if (query.includes('INSERT dbo.GroupMembers')) {
      assert.ok(!members.has(p.player), 'Creator must not be inserted twice.');
      members.set(p.player, { player_id: p.player, name_snapshot: p.name, position: p.position, is_admin: false }); return result([]);
    }
    if (query.includes('UPDATE dbo.GroupMembers SET is_admin')) {
      assert.ok(members.has(p.player)); members.get(p.player).is_admin = p.admin; return result([]);
    }
    if (query.includes('DELETE dbo.GroupMembers')) { members.delete(p.player); return result([]); }
    if (query.includes('UPDATE dbo.GroupMembers SET position')) { members.get(p.player).position = p.position; return result([]); }
    if (query.includes('UPDATE dbo.Groups SET next_game_number')) {
      row.counter = String(p.counter); row.is_public = p.public; row.avatar = p.avatar; version++; return result([]);
    }
    if (query.includes('SELECT r.player_id')) {
      assert.match(query, /LEFT JOIN dbo\.PlayerCodes/);
      return result(pendingRequests);
    }
    if (query.includes('FROM dbo.Games') || query.includes('FROM dbo.Tournaments') || query.includes('FROM dbo.GroupJoinRequests')) return result([]);
    throw new Error(`Unhandled synthetic SQL operation: ${query.slice(0, 100)}`);
  });
  return { store: createSqlStore(new sql.ConnectionPool({ server: 'example.test' })), members, profiles, codes, codeErrors, pendingRequests, inserts: () => inserts, queries };
}

test('authorized join-request lists expose the same code while keeping the approval target UUID', async t => {
  const f = fixture(t, true), target = people[4];
  f.pendingRequests.push({ player_id: target.id, display_name: target.name, code: target.code });
  assert.deepEqual(await f.store.requests(people[1], 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'),
    [{ playerId: target.id, displayName: target.name, code: target.code }]);
});

test('player code generation uses the full unambiguous 32-symbol alphabet and exactly six characters', () => {
  assert.equal(PLAYER_CODE_ALPHABET.length, 32);
  assert.equal(new Set(PLAYER_CODE_ALPHABET).size, 32);
  for (let i = 0; i < 100; i++) {
    const code = generatePlayerCode();
    assert.equal(code.length, 6);
    assert.equal(validatePlayerCode(code), code);
    assert.doesNotMatch(code, /[IO01]/);
  }
});

test('SQL profile sync keeps existing codes stable, ignores supplied aliases, and allocates only missing codes', async t => {
  const f = fixture(t);
  const actor = people[0];
  assert.equal((await f.store.syncPlayer({ ...actor, code: 'ZZZZZZ', name: 'Updated name' })).code, actor.code);
  assert.equal((await f.store.syncPlayer(actor)).code, actor.code);
  f.codes.delete(actor.id);
  const first = await f.store.syncPlayer(actor);
  assert.equal(validatePlayerCode(first.code), first.code);
  assert.equal((await f.store.syncPlayer({ ...actor, avatar: 'fox' })).code, first.code);
  assert.equal(first.id, actor.id);
  assert.ok(f.queries.some(query => /FROM dbo\.Players WITH \(UPDLOCK, HOLDLOCK\)/.test(query)), 'Same-player allocation is serialized.');
});

function duplicateCodeError(constraint = 'PK_PlayerCodes') {
  const error = new sql.RequestError(`Violation of constraint '${constraint}'.`, 'EREQUEST');
  error.number = 2627;
  return error;
}

test('code collisions retry whole rolled-back transactions with a strict bound; unrelated duplicates are not retried', async t => {
  const f = fixture(t), actor = people[0];
  f.codes.delete(actor.id);
  f.codeErrors.push(duplicateCodeError(), duplicateCodeError());
  const saved = await f.store.syncPlayer(actor);
  assert.equal(saved.code, f.codes.get(actor.id));
  assert.equal(sql.Transaction.prototype.rollback.mock.callCount(), 2);
  assert.equal(sql.Transaction.prototype.commit.mock.callCount(), 1);
  f.codes.delete(actor.id);
  const unrelated = duplicateCodeError('UX_PlayerCodes_Player');
  f.codeErrors.push(unrelated);
  await assert.rejects(f.store.syncPlayer(actor), error => error === unrelated);
  assert.equal(sql.Transaction.prototype.rollback.mock.callCount(), 3);
  f.codeErrors.push(...Array.from({ length: 8 }, () => duplicateCodeError()));
  await assert.rejects(f.store.syncPlayer(actor), error => error.status === 503 && error.code === 'player_code_unavailable');
  assert.equal(sql.Transaction.prototype.rollback.mock.callCount(), 11);
  assert.equal(f.codes.has(actor.id), false);
});

test('code lookup is exact, normalizes input, and excludes guest, deleted, retired and unknown accounts', async t => {
  const f = fixture(t), actor = people[0], target = people[1];
  assert.equal(await f.store.resolvePlayerCode(actor, ` ${target.code.toLowerCase()} `), target.id);
  for (const flags of [{ isGuest: true }, { isDeleted: true }]) {
    f.profiles.set(target.id, { ...target, ...flags });
    await assert.rejects(f.store.resolvePlayerCode(actor, target.code), error => error.status === 404);
    await assert.rejects(f.store.syncPlayer({ ...target, ...flags }), error => error.status === 403);
  }
  f.profiles.delete(target.id);
  await assert.rejects(f.store.resolvePlayerCode(actor, target.code), error => error.status === 404);
  await assert.rejects(f.store.resolvePlayerCode(actor, 'ZZZZZZ'), error => error.status === 404);
  await assert.rejects(f.store.resolvePlayerCode(actor, 'bad'), /six-character/);
});

test('SQL creation enrolls the owner transactionally; replay never enrolls them again after roster removal', async t => {
  const f = fixture(t), key = randomUUID();
  const first = await f.store.create(people[0], 'Synthetic creation', key, fingerprint);
  assert.deepEqual(first.players, [people[0]]);
  assert.equal(first.isOwner, true);
  assert.equal(first.canManage, true);
  assert.deepEqual(first.adminIds, []);
  const replay = await f.store.create(people[0], 'Synthetic creation', key, fingerprint);
  assert.deepEqual(replay, first);
  assert.equal(f.inserts(), 1);
  const empty = await f.store.change(people[0], first.id, first.revision,
    { type: 'remove-player', playerId: people[0].id }, null, randomUUID(), fingerprint);
  assert.deepEqual(empty.players, []);
  assert.equal(empty.isOwner, true);
  assert.deepEqual((await f.store.create(people[0], 'Synthetic creation', key, fingerprint)).players, []);
  assert.equal(f.inserts(), 1);
});

test('SQL reads and writes recheck admin access, enforce owner-only actions, and revoke privileges immediately', async t => {
  const f = fixture(t, true), id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const admin = await f.store.get(people[1], id);
  assert.equal(admin.canManage, true);
  assert.equal(admin.isOwner, false);
  assert.deepEqual(admin.adminIds, [people[1].id]);
  assert.equal((await f.store.get(people[2], id)).canManage, false);
  await assert.rejects(f.store.get(people[4], id), error => error.status === 404);
  assert.deepEqual(await f.store.requests(people[1], id), []);
  for (const action of [{ type: 'delete' }, { type: 'transfer', playerId: people[2].id }]) {
    await assert.rejects(f.store.changeOwnership(people[1], id, admin.revision, action, people[2], randomUUID(), fingerprint), error => error.status === 403);
  }
  const grant = { type: 'set-admin', playerId: people[2].id, isAdmin: true }, key = randomUUID();
  const elevated = await f.store.change(people[1], id, admin.revision, grant, people[2], key, fingerprint);
  assert.deepEqual(elevated.adminIds, people.slice(1, 3).map(p => p.id));
  assert.notEqual(elevated.revision, admin.revision);
  const repeated = await f.store.change(people[1], id, admin.revision, grant, people[2], key, fingerprint);
  assert.deepEqual(repeated, elevated);
  assert.equal((await f.store.get(people[2], id)).canManage, true);
  await assert.rejects(f.store.change(people[1], id, admin.revision,
    { type: 'set-avatar', avatar: 'trophy' }, null, randomUUID(), fingerprint), error => error.status === 412);
  const demoted = await f.store.change(people[2], id, elevated.revision,
    { type: 'set-admin', playerId: people[1].id, isAdmin: false }, null, randomUUID(), fingerprint);
  assert.equal((await f.store.get(people[1], id)).canManage, false);
  await assert.rejects(f.store.requests(people[1], id), error => error.status === 403);
  await assert.rejects(f.store.change(people[1], id, demoted.revision,
    { type: 'set-visibility', isPublic: true }, null, randomUUID(), fingerprint), error => error.status === 403);
  await assert.rejects(f.store.changeTournament(people[1], id, null,
    { type: 'create', name: 'Denied', teams: [] }, randomUUID(), fingerprint), error => error.status === 403);
  const remaining = await f.store.change(people[0], id, demoted.revision,
    { type: 'remove-player', playerId: people[2].id }, null, randomUUID(), fingerprint);
  assert.deepEqual(remaining.adminIds, []);
  await assert.rejects(f.store.get(people[2], id), error => error.status === 404);
});

test('SQL roster reads use current account names but preserve guest and anonymous labels and revisions', async t => {
  const f = fixture(t, true), id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const local = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', name: 'Visitor', isGuest: true },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007', name: 'Deleted player', isDeleted: true },
  ];
  for (const [index, player] of local.entries()) {
    f.members.set(player.id, { player_id: player.id, name_snapshot: player.name, position: 4 + index, is_admin: false });
    f.profiles.set(player.id, { ...player, name: 'Not an account label', avatar: 'smile' });
  }
  const before = await f.store.get(people[0], id);
  for (const person of people.slice(0, 2)) await f.store.syncPlayer({ ...person, name: 'Current shared name', avatar: 'fox' });
  const after = await f.store.get(people[2], id);
  assert.equal(after.ownerName, 'Current shared name');
  assert.deepEqual(after.players.slice(0, 2), people.slice(0, 2).map(p => ({ ...p, name: 'Current shared name', avatar: 'fox' })));
  assert.deepEqual(after.players.slice(2), before.players.slice(2));
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.games, before.games);
  assert.deepEqual(after.adminIds, before.adminIds);
  assert.equal(f.members.get(people[0].id).name_snapshot, people[0].name, 'Stored snapshots do not need a rewrite.');
});
