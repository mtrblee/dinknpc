import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiBaseUrl, createGroupsApi, dataErrorMessage, DataError, mergeSavedGroups } from './groupsApi.ts';
import { addPlayer, recordResult, startGame } from '../domain/groups.ts';
import { changeTournament, createRotatingTournament, createTournament, currentMatchGame, startPlayoffs } from '../domain/tournaments.ts';
import { summarizeGroup } from '../types/api.ts';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const group = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Friends',
  currency: 'money', avatar: 'paddles',
  ownerId: actorId, ownerName: 'Alex', canEdit: true, canManage: true, isPublic: false, revision: '0000000000000001',
  players: [], games: [], nextGameNumber: 1, isOwner: true, adminIds: [],
};

test('summary activity accepts canonical dates and explicit legacy unknowns but rejects malformed or contradictory metadata', async () => {
  const latestCompletedAt = '2026-10-27T16:30:00.000Z';
  const summary = { ...summarizeGroup(group), completedGameCount: 2, latestCompletedAt };
  let calls = 0;
  const api = fixture(async url => {
    calls++;
    assert.ok(url.endsWith('/groups?view=summary'));
    return Response.json({ groups: [summary] });
  });
  assert.deepEqual(await api.summaries(), [summary]);
  assert.equal(calls, 1, 'Adding activity must not fetch group histories.');
  for (const invalid of ['', 0, 'bad', '2026-02-30T00:00:00.000Z', '2026-10-27', '2026-10-27T12:30:00.000-04:00']) {
    await assert.rejects(fixture(async () => Response.json({ groups: [{ ...summary, latestCompletedAt: invalid }] })).summaries(), DataError);
  }
  await assert.rejects(fixture(async () => Response.json({ groups: [{ ...summary, completedGameCount: 0 }] })).summaries(), DataError);
  for (const latestCompletedAt of [null, undefined]) {
    const compatible = { ...summary, latestCompletedAt };
    const result = await fixture(async () => Response.json({ groups: [compatible] })).summaries();
    assert.equal(result[0].latestCompletedAt, latestCompletedAt);
  }
});

test('summary loading requests the lightweight view and accepts only safe, complete summary metadata', async () => {
  const summary = { ...summarizeGroup(group), playerCount: 7, completedGameCount: 23 };
  const api = fixture(async (url, options) => {
    assert.equal(url, 'https://example.test/api/groups?view=summary');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return Response.json({ groups: [summary] });
  });

  test('admin writes use versioned requests and strict role metadata without treating admins as owners', async () => {
    const member = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', name: 'Synthetic member' };
    const target = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', name: 'Synthetic candidate' };
    const populated = { ...addPlayer(group, member), isOwner: false, ownerId: member.id,
      players: [{ id: actorId, name: 'Synthetic admin' }, member, target], adminIds: [actorId] };
    const calls = [];
    const api = fixture(async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) throw new Error('Synthetic lost response');
      return Response.json({ group: { ...populated, adminIds: [actorId, target.id] } });
    });
    const action = { type: 'set-admin', playerId: target.id, isAdmin: true };
    await assert.rejects(api.change(populated, action), DataError);
    const saved = await api.change(populated, action);
    assert.equal(saved.isOwner, false);
    assert.equal(saved.canManage, true);
    assert.equal(calls[1].url, `https://example.test/api/groups/${group.id}/players/${target.id}/admin`);
    assert.deepEqual(JSON.parse(calls[1].options.body), { isAdmin: true });
    assert.equal(calls[1].options.headers['If-Match'], `"${group.revision}"`);
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    assert.equal(summarizeGroup(saved).isOwner, false);
    for (const invalid of [
      { isOwner: undefined }, { isOwner: 'true' }, { isOwner: true, canManage: false }, { canEdit: false },
      { adminIds: undefined }, { adminIds: [actorId, actorId] }, { adminIds: [member.id] }, { adminIds: ['invalid'] },
      { adminIds: ['ffffffff-ffff-4fff-8fff-000000000001'] },
      { players: [{ id: actorId, name: 'Synthetic guest', isGuest: true }, member] },
      { players: [{ id: actorId, name: 'Deleted player', avatar: 'smile', isDeleted: true }, member] },
    ]) await assert.rejects(fixture(async () => Response.json({ group: { ...populated, ...invalid } })).get(group.id), DataError);
  });
  assert.deepEqual(await api.summaries(), [summary]);
  for (const invalid of [
    { playerCount: -1 }, { playerCount: 1.5 }, { completedGameCount: Number.MAX_SAFE_INTEGER + 1 },
    { completedGameCount: '2' }, { completedGameCount: undefined }, { ownerId: 'invalid' },
    { revision: 'bad' }, { canManage: 'true' }, { canEdit: undefined }, { isPublic: 1 },
    { avatar: 'smile' }, { currency: 'unknown' }, { name: '' },
  ]) {
    await assert.rejects(fixture(async () => Response.json({ groups: [{ ...summary, ...invalid }] })).summaries(), DataError);
  }
  await assert.rejects(fixture(async () => Response.json({ groups: [summary, summary] })).summaries(), /duplicate/);
  for (const payload of [{}, { groups: null }, { groups: [summary, group] }]) {
    await assert.rejects(fixture(async () => Response.json(payload)).summaries(), DataError);
  }
});

test('old API full-list responses remain compatible without hiding errors or accepting malformed histories', async (t) => {
  const warning = t.mock.method(console, 'warn', () => {});
  const api = fixture(async () => Response.json({ groups: [group] }));
  assert.deepEqual(await api.summaries(), [summarizeGroup(group)]);
  await api.summaries();
  assert.equal(warning.mock.callCount(), 1);
  await assert.rejects(fixture(async () => Response.json({ groups: [{ ...group, games: [{}] }] })).summaries(), DataError);
  for (const status of [401, 403, 404, 500]) {
    let calls = 0;
    await assert.rejects(fixture(async () => {
      calls++;
      return Response.json({ error: { message: 'Synthetic failure' } }, { status });
    }).summaries(), (error) => error.status === status);
    assert.equal(calls, 1, 'Never retry an error as a full-list success.');
  }
});

test('summary payload does not grow with game history and load timings contain no identifiers or tokens', async () => {
  const history = { ...group, games: Array.from({ length: 1000 }, (_, index) => ({
    id: `synthetic-${index}`, status: 'completed', scoreA: 11, scoreB: 5, wagerUnits: 0,
    teamA: ['a', 'b'], teamB: ['c', 'd'],
  })) };
  const summary = summarizeGroup(history);
  const fullBytes = Buffer.byteLength(JSON.stringify({ groups: [history] }));
  const summaryBytes = Buffer.byteLength(JSON.stringify({ groups: [summary] }));
  assert.ok(summaryBytes < fullBytes * 0.05, 'At least 95% smaller for this 1,000-game synthetic fixture.');
  assert.equal(summary.completedGameCount, 1000);
  const timings = [];
  const body = JSON.stringify({ groups: [summary] });
  const api = createGroupsApi('https://example.test/api', actorId,
    async () => ({ userId: actorId, accessToken: 'synthetic-private-token' }), () => 'unused',
    async () => new Response(body), (timing) => timings.push(timing));
  await api.summaries();
  assert.equal(timings.length, 1);
  assert.deepEqual(Object.keys(timings[0]).sort(),
    ['operation', 'status', 'durationMs', 'sessionMs', 'requestMs', 'decodeMs', 'responseCharacters'].sort());
  assert.equal(timings[0].operation, 'summaries');
  assert.equal(timings[0].responseCharacters, body.length);
  for (const field of ['durationMs', 'sessionMs', 'requestMs', 'decodeMs']) assert.ok(timings[0][field] >= 0);
  assert.ok(!JSON.stringify(timings).includes(actorId));
  assert.ok(!JSON.stringify(timings).includes('synthetic-private-token'));
});

test('group lifecycle retries preserve request identity and acknowledge access loss without requiring a group DTO', async () => {
  for (const action of [{ type: 'transfer', playerId: actorId }, { type: 'delete' }]) {
    const calls = [];
    const api = fixture(async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) throw new Error('Synthetic response loss');
      return Response.json({ groupId: group.id, action: action.type });
    });
    await assert.rejects(api.changeOwnership(group, action), DataError);
    assert.deepEqual(await api.changeOwnership(group, action), { groupId: group.id, action: action.type });
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    assert.equal(calls[1].options.headers['If-Match'], `"${group.revision}"`);
    assert.equal(calls[1].options.method, action.type === 'transfer' ? 'POST' : 'DELETE');
  }
  const invalid = fixture(async () => Response.json({ groupId: actorId, action: 'delete' }));
  await assert.rejects(invalid.changeOwnership(group, { type: 'delete' }), DataError);
});

test('account deletion uses explicit fresh credentials and stable receipts, while status needs no session', async () => {
  const receipt = 'cccccccc-cccc-4ccc-8ccc-000000000010';
  const calls = [];
  const api = fixture(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: receipt, status: 'pending', retrying: false });
  }, async () => { throw new Error('An expired primary session must not be used'); });
  assert.equal((await api.deleteAccount({ userId: actorId, accessToken: 'fresh-synthetic-token' }, receipt)).id, receipt);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fresh-synthetic-token');
  assert.equal(calls[0].options.headers['Idempotency-Key'], receipt);
  assert.deepEqual(JSON.parse(calls[0].options.body), { confirmation: 'DELETE' });
  await api.deletionStatus(receipt);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.ok(calls[1].url.endsWith(`/account-deletions/${receipt}`));
  await assert.rejects(api.deleteAccount({ userId: group.id, accessToken: 'wrong-account' }, receipt), /account changed/);
  for (const response of [{ id: actorId, status: 'completed', retrying: false },
    { id: receipt, status: 'completed', retrying: true }, { id: receipt, status: 'unknown', retrying: false }]) {
    await assert.rejects(fixture(async () => Response.json(response)).deletionStatus(receipt), DataError);
  }
});

test('deleted roster entries remain readable history but never decode as active profiles or malformed anonymous players', async () => {
  const anonymous = { id: actorId, name: 'Deleted player', avatar: 'smile', isDeleted: true };
  const api = fixture(async () => Response.json({ group: { ...group, players: [anonymous] } }));
  assert.deepEqual((await api.get(group.id)).players, [anonymous]);
  await assert.rejects(fixture(async () => Response.json({ player: anonymous })).syncProfile(), DataError);
  for (const change of [{ isDeleted: 'true' }, { name: 'Previous name' }, { avatar: 'fox' }, { isGuest: true }]) {
    await assert.rejects(fixture(async () => Response.json({ group: { ...group, players: [{ ...anonymous, ...change }] } })).get(group.id), DataError);
  }
});

test('departures override stale lists and late saves without preventing a later authoritative membership refresh', () => {
  const later = { ...group, revision: '0000000000000002' };
  assert.deepEqual(mergeSavedGroups([group], [later], [group.id]), []);
  const joined = { ...later, canManage: false, isOwner: false };
  assert.deepEqual(mergeSavedGroups([joined], []), [joined]);
});
function fixture(fetcher, getToken = async () => ({ userId: actorId, accessToken: 'synthetic-token' })) {
  let key = 0;
  return createGroupsApi('https://example.test/api', actorId, getToken,
    () => `cccccccc-cccc-4ccc-8ccc-${String(++key).padStart(12, '0')}`, fetcher);
}

test('player codes survive profile and roster parsing while aliases are normalized only for registered-player additions', async () => {
  const player = { id: actorId, name: 'Synthetic account', avatar: 'fox', code: 'K7M2Q9' };
  const populated = { ...group, players: [player] };
  const calls = [];
  const api = fixture(async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/me') ? { player } : { group: populated });
  });
  assert.deepEqual(await api.syncProfile(), player);
  assert.deepEqual((await api.get(group.id)).players, [player]);
  const join = { playerId: actorId, displayName: player.name, code: player.code };
  assert.deepEqual(await fixture(async () => Response.json({ requests: [join] })).requests(group.id), [join]);
  await assert.rejects(fixture(async () => Response.json({ requests: [{ ...join, code: 'bad' }] })).requests(group.id), DataError);
  for (const reference of [' k7m2q9 ', ` ${actorId.toUpperCase()} `]) {
    await api.change(group, { type: 'add-player', playerId: reference });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { playerId: reference.trim().length === 6 ? 'K7M2Q9' : actorId });
  }
  const count = calls.length;
  assert.throws(() => api.change(group, { type: 'add-player', playerId: 'bad' }),
    error => /six-character/.test(dataErrorMessage(error)));
  assert.equal(calls.length, count);
  for (const invalid of [null, 123456, '', 'ABCD01', actorId]) {
    await assert.rejects(fixture(async () => Response.json({ player: { ...player, code: invalid } })).syncProfile(), DataError);
  }
  for (const invalid of [
    { ...player, isGuest: true }, { ...player, isDeleted: true, name: 'Deleted player', avatar: 'smile' },
  ]) await assert.rejects(fixture(async () => Response.json({ group: { ...populated, players: [invalid] } })).get(group.id), DataError);
  const duplicate = { ...player, id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002' };
  await assert.rejects(fixture(async () => Response.json({ group: { ...populated, players: [player, duplicate] } })).get(group.id), DataError);
  const { code, ...legacy } = player;
  assert.deepEqual(await fixture(async () => Response.json({ player: legacy })).syncProfile(), legacy);
});

test('group creation sends None by default and keeps currency/avatar in uncertain retry identity', async () => {
  const calls = [];
  const api = fixture(async (_url, options) => {
    calls.push(options);
    const input = JSON.parse(options.body);
    if (calls.length <= 3) throw new Error('Synthetic response loss');
    return Response.json({ group: { ...group, ...input } });
  });
  await assert.rejects(api.create('Options'), DataError);
  await assert.rejects(api.create('Options', 'money'), DataError);
  await assert.rejects(api.create('Options', 'money', 'trophy'), DataError);
  const saved = await api.create('Options', 'money', 'trophy');
  assert.deepEqual(JSON.parse(calls[0].body), { name: 'Options', currency: 'none', avatar: 'paddles' });
  assert.equal(new Set(calls.slice(0, 3).map((call) => call.headers['Idempotency-Key'])).size, 3);
  assert.equal(calls[2].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
  assert.equal(saved.currency, 'money');
  assert.equal(saved.avatar, 'trophy');
});

test('avatar changes are versioned group-only writes with safe retries', async () => {
  const calls = [];
  const api = fixture(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('Synthetic response loss');
    return Response.json({ group: { ...group, avatar: 'island', revision: '0000000000000002' } });
  });
  const action = { type: 'set-avatar', avatar: 'island' };
  await assert.rejects(api.change(group, action), DataError);
  assert.equal((await api.change(group, action)).avatar, 'island');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(calls[1].url, `https://example.test/api/groups/${group.id}/avatar`);
  assert.equal(calls[1].options.headers['If-Match'], `"${group.revision}"`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { avatar: 'island' });
});

test('group and discovery responses reject missing or unsupported group options', async () => {
  for (const currency of [undefined, null, 'USD', 'Money', 0]) {
    await assert.rejects(fixture(async () => Response.json({ groups: [{ ...group, currency }] })).list(), DataError);
  }
  for (const avatar of [undefined, null, 'smile', 'unknown', 0]) {
    await assert.rejects(fixture(async () => Response.json({ groups: [{ ...group, avatar }] })).list(), DataError);
    await assert.rejects(fixture(async () => Response.json({
      groups: [{ id: group.id, name: group.name, avatar, ownerName: 'Alex', memberCount: 0, relationship: 'none' }], nextCursor: null,
    })).search(''), DataError);
  }
  let populated = group;
  for (let index = 1; index <= 4; index++) populated = addPlayer(populated, {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Synthetic ${index}`,
  });
  const ids = populated.players.map((player) => player.id);
  populated = startGame(populated, ids.slice(0, 2), ids.slice(2), '2');
  await assert.rejects(fixture(async () => Response.json({ group: { ...populated, currency: 'none' } })).get(group.id), DataError);
  const boba = await fixture(async () => Response.json({ group: { ...populated, currency: 'boba',
    games: [{ ...populated.games[0], wagerUnits: 2 }] } })).get(group.id);
  assert.equal(boba.games[0].wagerUnits, 2);
  const { wagerUnits, ...legacy } = populated.games[0];
  await assert.rejects(fixture(async () => Response.json({ group: { ...populated, games: [{ ...legacy, wagerCents: wagerUnits }] } })).get(group.id), DataError);
});

test('guest creation sends only a name and safely retries across refreshed group revisions', async () => {
  const guest = { id: 'dddddddd-dddd-4ddd-8ddd-000000000001', name: 'Visitor', isGuest: true, avatar: 'smile' };
  const requests = [];
  const api = fixture(async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) throw new Error('Synthetic uncertain save');
    return Response.json({ group: { ...group, revision: '0000000000000003', players: [guest] } });
  });
  await assert.rejects(api.change(group, { type: 'add-guest', name: 'Visitor' }), DataError);
  const saved = await api.change({ ...group, revision: '0000000000000002' }, { type: 'add-guest', name: 'Visitor' });
  assert.deepEqual(saved.players, [guest]);
  assert.ok(requests.every(({ url }) => url.endsWith(`/groups/${group.id}/guests`)));
  assert.ok(requests.every(({ options }) => options.method === 'POST' && options.headers['If-Match'] === undefined));
  assert.deepEqual(JSON.parse(requests[1].options.body), { name: 'Visitor' });
  assert.equal(requests[0].options.headers['Idempotency-Key'], requests[1].options.headers['Idempotency-Key']);
  await api.change(saved, { type: 'add-guest', name: 'Visitor' });
  assert.notEqual(requests[1].options.headers['Idempotency-Key'], requests[2].options.headers['Idempotency-Key']);
});

test('guest flags must be boolean roster metadata and cannot represent the signed-in profile', async () => {
  for (const isGuest of ['true', 1, null]) {
    await assert.rejects(fixture(async () => Response.json({ groups: [{ ...group, players: [{ id: actorId, name: 'Visitor', isGuest }] }] })).list(), DataError);
  }
  await assert.rejects(fixture(async () => Response.json({ player: { id: actorId, name: 'Visitor', isGuest: true } })).syncProfile(), DataError);
  const regular = await fixture(async () => Response.json({ groups: [{ ...group, players: [{ id: actorId, name: 'Member', isGuest: false }] }] })).list();
  assert.notEqual(regular[0].players[0].isGuest, true);
});

test('player removal sends a versioned DELETE without account metadata and reuses uncertain request keys', async () => {
  const requests = [];
  const api = fixture(async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) throw new Error('Synthetic uncertain removal');
    return Response.json({ group: { ...group, revision: '0000000000000002' } });
  });
  const populated = { ...group, players: [{ id: actorId, name: 'Alex' }] };
  await assert.rejects(api.change(populated, { type: 'remove-player', playerId: actorId }), DataError);
  assert.equal((await api.change(populated, { type: 'remove-player', playerId: actorId })).players.length, 0);
  assert.ok(requests.every(({ url, options }) => url.endsWith(`/groups/${group.id}/players/${actorId}`) &&
    options.method === 'DELETE' && options.body === undefined && options.headers['If-Match'] === `"${group.revision}"`));
  assert.equal(requests[0].options.headers['Idempotency-Key'], requests[1].options.headers['Idempotency-Key']);
});

test('game reads retain server timestamps, accept historical unknowns and reject invalid metadata', async () => {
  let populated = group;
  for (let index = 1; index <= 4; index++) populated = addPlayer(populated, {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Synthetic ${index}`,
  });
  const ids = populated.players.map((player) => player.id);
  populated = startGame(populated, ids.slice(0, 2), ids.slice(2), '0');
  const pending = populated.games[0];
  const completed = recordResult(populated, pending.id, '11', '7').games[0];
  const createdAt = '2026-10-22T16:00:00.000Z';
  const completedAt = '2026-10-23T16:00:00.000Z';
  const api = (game) => fixture(async () => Response.json({ groups: [{ ...populated, games: [game] }] }));
  for (const game of [pending, { ...pending, createdAt, completedAt: null }, { ...completed, createdAt, completedAt },
    { ...completed, createdAt: null, completedAt: null }, { ...completed, createdAt: null, completedAt }]) {
    assert.deepEqual((await api(game).list())[0].games[0], game);
  }
  for (const game of [{ ...pending, createdAt: 'invalid' }, { ...pending, createdAt, completedAt },
    { ...completed, createdAt: completedAt, completedAt: createdAt }, { ...completed, completedAt: 0 }]) {
    await assert.rejects(api(game).list(), DataError);
  }
});

test('API configuration requires HTTPS and no embedded credentials', () => {
  assert.equal(apiBaseUrl('https://example.test/api/'), 'https://example.test/api');
  for (const url of [undefined, 'bad-url', 'http://example.test', 'https://user:pass@example.test', 'https://example.test/?key=1']) {
    assert.throws(() => apiBaseUrl(url), DataError);
  }
});

test('profile sync is bound to the current account and group avatars never expose extra profile fields', async () => {
  const player = { id: actorId, name: 'Alex', avatar: 'fox' };
  const api = fixture(async (url, options) => {
    assert.equal(options.method, 'GET');
    return Response.json(url.endsWith('/me')
      ? { player: { ...player, email: 'not-returned@example.test' } }
      : { groups: [{ ...group, players: [{ ...player, email: 'not-returned@example.test' }] }] });
  });
  assert.deepEqual(await api.syncProfile(), player);
  assert.deepEqual((await api.list())[0].players, [player]);
  for (const invalid of [{ ...player, id: group.id }, { ...player, avatar: 'unknown' }, { ...player, avatar: null }]) {
    await assert.rejects(fixture(async () => Response.json({ player: invalid })).syncProfile(), DataError);
  }
  await assert.rejects(fixture(async () => Response.json({ groups: [{ ...group, players: [{ ...player, avatar: 'unknown' }] }] })).list(), DataError);
});

test('group reads validate response data and writes send identity, version and action payload', async () => {
  const requests = [];
  const api = fixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(options.method === 'GET' ? { groups: [group] } : { group });
  });
  assert.deepEqual(await api.list(), [group]);
  assert.deepEqual(await api.change(group, { type: 'start-game', teamA: [actorId], teamB: [], wager: '5' }), group);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(requests[1].options.headers['If-Match'], '"0000000000000001"');
  assert.match(requests[1].options.headers['Idempotency-Key'], /^cccccccc-/);
  assert.deepEqual(JSON.parse(requests[1].options.body), { teamA: [actorId], teamB: [], wager: '5' });
});

test('uncertain writes retain their idempotency key until a valid acknowledgement', async () => {
  const keys = [];
  let step = 0;
  const api = fixture(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    step++;
    if (step === 1) throw new Error('synthetic network failure');
    if (step === 2) return Response.json({ error: { message: 'Resuming database.' } }, { status: 503 });
    if (step === 3) return new Response('not JSON');
    if (step === 4) return Response.json({ group: { ...group, revision: 'bad' } });
    return Response.json({ group });
  });
  for (let i = 0; i < 4; i++) await assert.rejects(api.create('Friends'), DataError);
  await api.create('Friends');
  assert.equal(new Set(keys).size, 1);
  await api.create('Friends');
  assert.notEqual(keys[5], keys[4]);
});

test('definitive validation and concurrency errors are surfaced and release the old request key', async () => {
  const keys = [];
  const api = fixture(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    return Response.json({ error: { code: 'group_changed', message: 'Refresh this group.' } }, { status: 412 });
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(api.change(group, { type: 'delete-game', gameId: 'synthetic-game' }),
      (error) => error.status === 412 && error.message === 'Refresh this group.');
  }
  assert.notEqual(keys[0], keys[1]);
});

test('an old workspace cannot send a request using another account session', async () => {
  let called = false;
  const api = fixture(async () => { called = true; return Response.json({ groups: [] }); },
    async () => ({ userId: 'another-user', accessToken: 'synthetic-token' }));
  await assert.rejects(api.list(), (error) => error.status === 401);
  assert.equal(called, false);
});

test('malformed group responses are errors, never an empty-group fallback', async () => {
  for (const data of [
    {}, { groups: null }, { groups: [group, group] },
    { groups: [{ ...group, nextGameNumber: 0 }] },
    { groups: [{ ...group, canEdit: 'yes' }] },
    { groups: [{ ...group, players: [{ id: actorId, name: 'Alex' }, { id: actorId, name: 'Alex' }] }] },
    { groups: [{ ...group, games: [{ id: 'game', status: 'pending', teamA: [], teamB: [], wagerUnits: 0 }] }] },
  ]) {
    await assert.rejects(fixture(async () => Response.json(data)).list(), DataError);
  }
});

test('refresh merges preserve concurrent saves without overwriting a newer server version', () => {
  const newer = { ...group, revision: '0000000000000003' };
  const middle = { ...group, revision: '0000000000000002' };
  const created = { ...group, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' };
  assert.deepEqual(mergeSavedGroups([group], [newer, created]), [newer, created]);
  assert.deepEqual(mergeSavedGroups([newer], [middle]), [newer]);
  assert.equal(group.revision, '0000000000000001');
});

test('public search, join status and creator controls have distinct request and response contracts', async () => {
  const requests = [];
  const api = fixture(async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/search?')) return Response.json({
      groups: [{ id: group.id, name: group.name, avatar: group.avatar, ownerName: 'Alex', memberCount: 2, relationship: 'none' }],
      nextCursor: null,
    });
    if (url.endsWith('/me')) return Response.json({ status: 'pending' });
    if (options.method === 'GET') return Response.json({ requests: [{ playerId: actorId, displayName: 'Alex' }] });
    return Response.json({ group });
  });
  assert.equal((await api.search('Friends %')).groups[0].memberCount, 2);
  assert.ok(requests[0].url.includes('Friends+%25'));
  assert.equal(await api.requestJoin(group.id), 'pending');
  assert.equal(requests[1].options.method, 'PUT');
  assert.deepEqual(await api.requests(group.id), [{ playerId: actorId, displayName: 'Alex' }]);
  await api.change(group, { type: 'set-visibility', isPublic: true });
  assert.deepEqual(JSON.parse(requests[3].options.body), { isPublic: true });
  await api.change(group, { type: 'review-request', playerId: actorId, decision: 'approve' });
  assert.deepEqual(JSON.parse(requests[4].options.body), { decision: 'approve' });
});

test('invalid discovery and duplicate request data are explicit failures', async () => {
  await assert.rejects(fixture(async () => Response.json({ groups: [{}], nextCursor: null })).search(''), DataError);
  await assert.rejects(fixture(async () => Response.json({ status: 'approved-without-membership' })).requestJoin(group.id), DataError);
  const row = { playerId: actorId, displayName: 'Alex' };
  await assert.rejects(fixture(async () => Response.json({ requests: [row, row] })).requests(group.id), DataError);
});

test('tournament snapshots preserve game tags and creation retries survive unrelated group revisions', async () => {
  let populated = group;
  for (let index = 1; index <= 4; index++) {
    populated = addPlayer(populated, { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Player ${index}` });
  }
  const teams = [populated.players.slice(0, 2).map((p) => p.id), populated.players.slice(2).map((p) => p.id)];
  const id = 'dddddddd-dddd-4ddd-8ddd-000000000001';
  const created = createTournament(populated, id, 'Cup', teams);
  const response = { group: created.group, tournaments: [created.tournament], selectedId: id };
  const calls = [];
  const api = fixture(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error('synthetic response loss');
    return Response.json(response);
  });

  const action = { type: 'create', name: 'Cup', teams };
  await assert.rejects(api.changeTournament(populated, action), DataError);
  const result = await api.changeTournament({ ...populated, revision: '0000000000000002' }, action);
  assert.equal(result.selectedId, id);
  assert.equal(result.group.games[0].tournament.id, id);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[0].headers['If-Match'], undefined);
  assert.equal((await api.tournaments(group.id)).tournaments.length, 1);
  const invalid = fixture(async () => Response.json({ ...response, tournaments: [{ ...created.tournament, style: 'unsupported' }] }));
  await assert.rejects(invalid.tournaments(group.id), DataError);
});

test('rotating creation serializes player IDs, safely retries and reads mixed tournament formats', async () => {
  let populated = group;
  for (let index = 1; index <= 8; index++) {
    populated = addPlayer(populated, { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Synthetic ${index}` });
  }
  const selected = populated.players.map(p => p.id);
  const fixed = createTournament(populated, 'dddddddd-dddd-4ddd-8ddd-000000000001', 'Fixed cup', [selected.slice(0, 2), selected.slice(2, 4)]);
  const rotating = createRotatingTournament(fixed.group, 'dddddddd-dddd-4ddd-8ddd-000000000002', 'Rotating cup', selected);
  const response = { group: rotating.group, tournaments: [fixed.tournament, rotating.tournament], selectedId: rotating.tournament.id };
  const calls = [];
  const api = fixture(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error('Synthetic response loss');
    return Response.json(response);
  });

  const action = { type: 'create', style: 'rotating-partner-round-robin', name: 'Rotating cup', players: selected };
  await assert.rejects(api.changeTournament(fixed.group, action), DataError);
  const saved = await api.changeTournament({ ...fixed.group, revision: '0000000000000002' }, action);
  assert.deepEqual(JSON.parse(calls[1].body), { name: action.name, style: action.style, players: selected });
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[1].headers['If-Match'], undefined);
  assert.equal(saved.tournaments[1].pool.length, 14);
  assert.deepEqual((await api.tournaments(group.id)).tournaments.map(t => t.style), ['fixed-round-robin', action.style]);
  const invalid = fixture(async () => Response.json({ ...response, tournaments: [{ ...rotating.tournament, seeds: ['team-1'] }] }));
  await assert.rejects(invalid.tournaments(group.id), DataError);
});

test('configured creation uses a new route that older APIs cannot silently treat as default rules and includes rules in retry identity', async () => {
    let populated = group;
    for (let index = 1; index <= 4; index++) populated = addPlayer(populated,
      { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Synthetic ${index}` });
    const teams = [populated.players.slice(0, 2).map(player => player.id), populated.players.slice(2).map(player => player.id)];
    const scoring = { pool: 15, playoff: 11, championship: 'best-of-3-11' };
    const id = 'dddddddd-dddd-4ddd-8ddd-000000000001';
    const calls = [];
    let lost = true;
    const api = fixture(async (url, options) => {
      calls.push({ url, options });
      const body = JSON.parse(options.body);
      if (lost) { lost = false; throw new Error('Synthetic response loss'); }
      const created = body.style === 'rotating-partner-round-robin'
        ? createRotatingTournament(populated, id, body.name, body.players, body.scoring)
        : createTournament(populated, id, body.name, body.teams, body.scoring);
      return Response.json({ group: created.group, tournaments: [created.tournament], selectedId: id });
    });
    const action = { type: 'create', name: 'Scoring choices', teams, scoring };
    await assert.rejects(api.changeTournament(populated, action), DataError);
    const saved = await api.changeTournament({ ...populated, revision: '0000000000000002' }, action);
    assert.ok(calls.every(call => call.url.endsWith('/tournaments/configured')));
    assert.deepEqual(JSON.parse(calls[1].options.body), { name: action.name, teams, style: 'fixed-round-robin', scoring });
    assert.deepEqual(saved.tournaments[0].scoring, scoring);
    assert.ok(saved.group.games.every(game => game.tournament.targetScore === 15));
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    await api.changeTournament(populated, { ...action, scoring: { ...scoring, pool: 11 } });
    assert.notEqual(calls[1].options.headers['Idempotency-Key'], calls[2].options.headers['Idempotency-Key']);
    const rotation = await api.changeTournament(populated, { type: 'create', style: 'rotating-partner-round-robin',
      name: 'Rotation 15', players: populated.players.map(player => player.id), scoring });
    assert.equal(rotation.tournaments[0].scoring.pool, 15);
  });

  test('series snapshots retain all game links and numbered history, reject invalid metadata, and send the exact game in score requests', async () => {
    let populated = group;
    for (let index = 1; index <= 4; index++) populated = addPlayer(populated,
      { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Synthetic ${index}` });
    const teams = [populated.players.slice(0, 2).map(player => player.id), populated.players.slice(2).map(player => player.id)];
    const id = 'dddddddd-dddd-4ddd-8ddd-000000000001';
    let state = createTournament(populated, id, 'Series', teams, { pool: 11, playoff: 15, championship: 'best-of-3-11' });
    state = changeTournament(state.group, state.tournament, { type: 'score', id, matchId: state.tournament.pool[0].id, scoreA: '11', scoreB: '7' });
    state = startPlayoffs(state.group, state.tournament, ['team-1', 'team-2']);
    let final = state.tournament.playoffs[0];
    const calls = [];
    const api = fixture(async (_url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); calls.push(body);
        state = changeTournament(state.group, state.tournament, { ...body, type: 'score', id, matchId: final.id });
        final = state.tournament.playoffs[0];
      }
      return Response.json({ group: state.group, tournaments: [state.tournament], selectedId: id });
    });
    for (let index = 0; index < 2; index++) {
      const gameId = currentMatchGame(state.group, final).id;
      const result = await api.changeTournament(state.group, { type: 'score', id, matchId: final.id, gameId, scoreA: '11', scoreB: '7' });
      assert.deepEqual(calls.at(-1), { scoreA: '11', scoreB: '7', gameId });
      assert.deepEqual(result.tournaments[0].playoffs[0].gameIds, final.gameIds);
    }
    const snapshot = await api.tournaments(group.id);
    assert.deepEqual(snapshot.group.games.filter(game => game.tournament.stage === 'championship').map(game => game.tournament.gameNumber), [1, 2]);
    for (const metadata of [{ targetScore: 12 }, { gameNumber: 4 }, { targetScore: 15, gameNumber: 1 }]) {
      const bad = { ...state.group, games: state.group.games.map(game => game.id === final.gameId
        ? { ...game, tournament: { ...game.tournament, ...metadata } } : game) };
      await assert.rejects(fixture(async () => Response.json({ group: bad, tournaments: [state.tournament] })).tournaments(group.id), DataError);
    }
  });
