import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApi } from './api.ts';
import { ApiError, applyCommand } from './contracts.ts';
import { createIdentityService } from './identity.ts';
import { createGroup, getStandings, removePlayer } from '../../src/domain/groups.ts';
import { mayChangeGroup, summarizeGroup } from '../../src/types/api.ts';
import { changeGroupAdmin, createOwnedGroup } from '../../src/domain/groupRoles.ts';

const players = ['Alex', 'Blair', 'Casey', 'Drew', 'Emery'].map((name, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`, name, avatar: 'smile',
}));
const owner = players[0];

function fixture() {
  const groups = new Map();
  const calls = [];
  let version = 0;
  const revision = () => (++version).toString(16).padStart(16, '0');
  const identity = {
    authenticate: async (header) => {
      const actor = players.find((player) => header === `Bearer ${player.id}`);
      if (!actor) throw new ApiError(401, 'unauthorized', 'Login required.');
      return { player: actor, token: actor.id };
    },
    findPlayer: async (id) => {
      calls.push('lookup');
      const player = players.find((entry) => entry.id === id);
      if (!player) throw new ApiError(404, 'player_not_found', 'Player missing.');
      return player;
    },
  };
  const store = {
    syncPlayer: async player => ({ ...player, code: 'K7M2Q9' }),
    resolvePlayerCode: async (_actor, code) => {
      calls.push('code-lookup');
      if (code !== 'K7M2Q9') throw new ApiError(404, 'player_not_found', 'No eligible registered player.');
      return players[1].id;
    },
    list: async (actor) => [...groups.values()].filter((group) =>
      group.ownerId === actor.id || group.players.some((player) => player.id === actor.id))
      .map((group) => ({ ...group, canEdit: true, isOwner: group.ownerId === actor.id,
        canManage: group.ownerId === actor.id || group.adminIds.includes(actor.id) })),
    summaries: async (actor) => (await store.list(actor)).map(summarizeGroup),
    get: async (actor, id) => {
      const group = (await store.list(actor)).find((entry) => entry.id === id);
      if (!group) throw new ApiError(404, 'group_not_found', 'Group missing.');
      return group;
    },
    create: async (actor, name, _key, _fingerprint, currency, avatar) => {
      const group = {
        ...createOwnedGroup([...groups.values()].filter((entry) => entry.ownerId === actor.id), name, actor, currency, avatar),
        id: randomUUID(), ownerId: actor.id, ownerName: actor.name, revision: revision(), canEdit: true, canManage: true,
        isOwner: true, adminIds: [], isPublic: false,
      };
      groups.set(group.id, group);
      return group;
    },
    change: async (actor, id, expected, command, player) => {
      calls.push('change');
      const current = await store.get(actor, id);
      if (!mayChangeGroup(current, command)) throw new ApiError(403, 'admin_required', 'Owner or admin required.');
      if (command.type !== 'add-guest' && current.revision !== expected) throw new ApiError(412, 'group_changed', 'Refresh required.');
      const changed = command.type === 'set-visibility' ? { ...current, isPublic: command.isPublic }
        : command.type === 'set-avatar' ? { ...current, avatar: command.avatar }
        : command.type === 'set-admin' ? { ...current, adminIds: changeGroupAdmin(current, actor.id, command.playerId, command.isAdmin) }
        : command.type === 'remove-player' ? { ...removePlayer(current, command.playerId, []), adminIds: current.adminIds.filter(id => id !== command.playerId) }
        : applyCommand(current, command, player);
      const group = { ...changed, revision: revision() };
      groups.set(id, group);
      return group;
    },
    ownershipReceipt: async () => null,
    changeOwnership: async (_actor, id, _revision, action) => { calls.push('ownership'); return { groupId: id, action: action.type }; },
  };
  const handler = createApi(store, identity, () => {});
  async function request(path, { actor = owner, method = 'GET', body, revision, authenticated = true, key = randomUUID() } = {}) {
    const response = await handler(new Request(`https://example.test/api${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${actor.id}` } : {}),
        'Content-Type': 'application/json', 'Idempotency-Key': key,
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { handler, request, groups, calls, store, identity };
}

test('adding by code authorizes first, resolves to a UUID, and fingerprints canonical identity before mutation', async () => {
  const { request, store, calls } = fixture();
  const group = (await request('/groups', { method: 'POST', body: { name: 'Synthetic codes' } })).data.group;
  const captured = [];
  store.change = async (...args) => { captured.push(args); return group; };
  const options = { method: 'POST', revision: group.revision, key: randomUUID() };
  assert.equal((await request(`/groups/${randomUUID()}/players`, { ...options, body: { playerId: 'K7M2Q9' } })).status, 404);
  assert.equal(calls.includes('code-lookup'), false);
  for (const reference of [' k7m2q9 ', players[1].id.toUpperCase()]) {
    assert.equal((await request(`/groups/${group.id}/players`, { ...options, body: { playerId: reference } })).status, 200);
  }
  assert.deepEqual(captured[0][3], { type: 'add-player', playerId: players[1].id });
  assert.equal(captured[0][4].id, players[1].id);
  assert.equal(captured[0][6], captured[1][6]);
  assert.deepEqual(calls, ['code-lookup', 'lookup', 'lookup']);
  assert.equal((await request(`/groups/${group.id}/players`, { ...options, body: { playerId: 'ZZZZZZ' } })).status, 404);
  assert.equal((await request(`/groups/${group.id}/players`, { ...options, body: { playerId: 'ABCD01' } })).status, 400);
  assert.equal(captured.length, 2);
});

test('codes do not bypass identity eligibility, duplicate membership, or UUID-only game and role operations', async () => {
  const { request, store, identity, groups } = fixture();
  const group = (await request('/groups', { method: 'POST', body: { name: 'Synthetic eligible players' } })).data.group;
  const options = { method: 'POST', revision: group.revision, body: { playerId: 'K7M2Q9' } };
  for (const invalid of [null, { isGuest: true }, { isDeleted: true }]) {
    identity.findPlayer = async (id, token) => {
      assert.equal(id, players[1].id);
      assert.equal(token, owner.id);
      if (!invalid) throw new ApiError(404, 'player_not_found', 'Account unverified, banned, missing or deleted.');
      return { ...players[1], ...invalid };
    };
    assert.equal((await request(`/groups/${group.id}/players`, options)).status, 404);
    assert.deepEqual(groups.get(group.id), group);
  }
  identity.findPlayer = async () => owner;
  store.resolvePlayerCode = async () => owner.id;
  assert.equal((await request(`/groups/${group.id}/players`, options)).status, 400);
  assert.equal((await request(`/groups/${group.id}/players/K7M2Q9/admin`, { ...options, body: { isAdmin: true } })).status, 400);
  assert.equal((await request(`/groups/${group.id}/games`, { ...options, body: {
    teamA: ['K7M2Q9', players[1].id], teamB: players.slice(2, 4).map(player => player.id),
  } })).status, 400);
  assert.deepEqual(groups.get(group.id), group);
});

test('health exposes no data; all data endpoints require authentication', async () => {
  const { request } = fixture();
  assert.equal((await request('/health', { authenticated: false })).status, 200);
  for (const path of ['/me', '/groups', '/groups?view=summary', '/groups/search', `/groups/${randomUUID()}`, `/groups/${randomUUID()}/join-requests`]) {
    const response = await request(path, { authenticated: false });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('summary view uses only its store query after authentication and profile checks, leaving full lists unchanged', async () => {
  const { request, store } = fixture();
  const created = (await request('/groups', { method: 'POST', body: { name: 'Synthetic summary' } })).data.group;
  const calls = [];
  store.syncPlayer = async (actor) => { assert.equal(actor.id, owner.id); calls.push('sync'); };
  store.summaries = async (actor) => {
    assert.equal(actor.id, owner.id);
    calls.push('summaries');
    return [summarizeGroup(created)];
  };
  const previousList = store.list;
  store.list = async (...args) => { calls.push('full'); return previousList(...args); };
  const response = await request('/groups?view=summary');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.data, { groups: [summarizeGroup(created)] });
  assert.deepEqual(calls, ['sync', 'summaries']);
  assert.deepEqual((await request('/groups')).data, { groups: [created] });
  assert.equal((await request('/groups?view=unsupported')).status, 400);
  calls.length = 0;
  store.syncPlayer = async () => { throw new ApiError(403, 'account_deleting', 'Deletion pending.'); };
  assert.equal((await request('/groups?view=summary')).status, 403);
  assert.deepEqual(calls, []);
});

test('group creation validates independent options, defaults None and fingerprints both selections', async () => {
  const { request, store } = fixture();
  const created = await request('/groups', { method: 'POST', body: { name: 'Default options' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.group.currency, 'none');
  assert.equal(created.data.group.avatar, 'paddles');
  assert.deepEqual(created.data.group.players, [owner]);
  assert.deepEqual(created.data.group.adminIds, []);
  assert.equal(created.data.group.isOwner, true);
  for (const options of [{ currency: null }, { currency: 'USD' }, { currency: 0 },
    { avatar: null }, { avatar: 'smile' }, { avatar: 'unknown' }]) {
    assert.equal((await request('/groups', { method: 'POST', body: { name: 'Invalid', ...options } })).status, 400);
  }
  const captured = [];
  store.create = async (...args) => { captured.push(args); return created.data.group; };
  const key = randomUUID();
  for (const options of [{ currency: 'none', avatar: 'paddles' }, { currency: 'money', avatar: 'paddles' },
    { currency: 'money', avatar: 'trophy' }, { currency: 'boba', avatar: 'trophy' }]) {
    assert.equal((await request('/groups', { method: 'POST', key, body: { name: 'Options', ...options } })).status, 201);
  }
  assert.equal(new Set(captured.map((args) => args[3])).size, 4);
  assert.deepEqual(captured.at(-1).slice(4), ['boba', 'trophy']);
});

test('owners and admins manage admin access and settings, but admins cannot delete or transfer groups', async () => {
  const { request, calls } = fixture();
  let group = (await request('/groups', { method: 'POST', body: {
    name: 'Synthetic roles', ownerId: players[4].id, adminIds: [players[4].id],
  } })).data.group;
  assert.equal(group.ownerId, owner.id);
  assert.deepEqual(group.players, [owner]);
  assert.deepEqual(group.adminIds, []);
  for (const player of players.slice(1, 4)) {
    group = (await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: player.id } })).data.group;
  }
  const path = player => `/groups/${group.id}/players/${player.id}/admin`;
  const update = (actor, player, isAdmin, revision = group.revision) =>
    request(path(player), { actor, method: 'POST', revision, body: { isAdmin } });
  assert.equal((await update(players[1], players[2], true)).status, 403);
  assert.equal((await update(players[4], players[2], true)).status, 404);
  assert.equal((await update(owner, owner, false)).status, 400);
  assert.equal((await update(owner, players[4], true)).status, 400);
  for (const isAdmin of [undefined, null, 'true', 1]) assert.equal((await update(owner, players[1], isAdmin)).status, 400);
  assert.equal((await update(owner, players[1], true, '0000000000000000')).status, 412);
  const granted = await update(owner, players[1], true);
  assert.equal(granted.status, 200);
  group = granted.data.group;
  const adminView = (await request(`/groups/${group.id}`, { actor: players[1] })).data.group;
  assert.equal(adminView.canManage, true);
  assert.equal(adminView.isOwner, false);
  assert.equal((await update(players[1], players[1], false)).status, 400);
  assert.equal((await update(players[1], owner, false)).status, 400);
  const elevated = await update(players[1], players[2], true);
  assert.equal(elevated.status, 200);
  group = elevated.data.group;
  assert.deepEqual(group.adminIds, players.slice(1, 3).map(player => player.id));
  const avatar = await request(`/groups/${group.id}/avatar`, {
    actor: players[1], method: 'POST', revision: group.revision, body: { avatar: 'trophy' },
  });
  assert.equal(avatar.status, 200);
  group = avatar.data.group;
  const guest = await request(`/groups/${group.id}/guests`, { actor: players[1], method: 'POST', body: { name: 'Visitor' } });
  assert.equal(guest.status, 200);
  group = guest.data.group;
  assert.equal((await update(owner, group.players.at(-1), false)).status, 400);
  for (const actor of players.slice(1, 3)) {
    assert.equal((await request(`/groups/${group.id}`, { actor, method: 'DELETE', revision: group.revision, body: { confirmation: 'DELETE' } })).status, 403);
    assert.equal((await request(`/groups/${group.id}/owner`, { actor, method: 'POST', revision: group.revision, body: { playerId: players[3].id } })).status, 403);
  }
  assert.equal(calls.includes('ownership'), false);
  const demoted = await update(players[2], players[1], false);
  assert.equal(demoted.status, 200);
  group = demoted.data.group;
  assert.equal((await update(players[1], players[3], true)).status, 403);
  assert.equal((await request(`/groups/${group.id}/guests`, { actor: players[1], method: 'POST', body: { name: 'Denied' } })).status, 403);
  assert.equal((await request(`/groups/${group.id}`, { actor: players[1] })).data.group.canManage, false);
  assert.deepEqual(group.players.slice(0, 4), players.slice(0, 4));
  assert.equal(group.ownerId, owner.id);
});

test('ordinary members cannot change group avatars and player avatars remain untouched', async () => {
  const { request } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Avatars', avatar: 'trophy' } })).data.group;
  group = (await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: players[1].id } })).data.group;
  const path = `/groups/${group.id}/avatar`;
  const change = { method: 'POST', revision: group.revision, body: { avatar: 'island' } };
  assert.equal((await request(path, { ...change, authenticated: false })).status, 401);
  assert.equal((await request(path, { ...change, actor: players[1] })).status, 403);
  assert.equal((await request(path, { ...change, actor: players[2] })).status, 404);
  assert.equal((await request(path, { ...change, revision: undefined })).status, 428);
  assert.equal((await request(path, { ...change, revision: '0000000000000000' })).status, 412);
  for (const avatar of ['smile', null, 'unknown', 0]) {
    assert.equal((await request(path, { ...change, body: { avatar } })).status, 400);
  }
  const saved = await request(path, change);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.group.avatar, 'island');
  assert.notEqual(saved.data.group.revision, group.revision);
  assert.deepEqual(saved.data.group.players, group.players);
  assert.equal(saved.data.group.currency, 'none');
});

test('casual API enforces None, whole Boba, whole-dollar USD and blank or omitted zero wagers', async () => {
  for (const currency of ['none', 'money', 'boba']) {
    const { request } = fixture();
    let group = (await request('/groups', { method: 'POST', body: { name: 'Currency', currency } })).data.group;
    for (const player of players.slice(1, 4)) {
      group = (await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: player.id } })).data.group;
    }
    const teams = { teamA: players.slice(0, 2).map((player) => player.id), teamB: players.slice(2, 4).map((player) => player.id) };
    for (const wager of [undefined, '', ' ']) {
      const response = await request(`/groups/${group.id}/games`, { method: 'POST', revision: group.revision, body: { ...teams, wager } });
      assert.equal(response.status, 200);
      group = response.data.group;
      assert.equal(group.games.at(-1).wagerUnits, 0);
    }
    const invalid = currency === 'none' ? ['1'] : currency === 'boba' ? ['1.5'] : ['0.01', '0.99', '1.25', '1.00', '0.00', '-1', '1e2'];
    for (const wager of invalid) {
      assert.equal((await request(`/groups/${group.id}/games`, {
        method: 'POST', revision: group.revision, body: { ...teams, wager },
      })).status, 400, wager);
    }
    assert.deepEqual((await request(`/groups/${group.id}`)).data.group, group);
    if (currency !== 'none') {
      const saved = await request(`/groups/${group.id}/games`, {
        method: 'POST', revision: group.revision, body: { ...teams, wager: currency === 'money' ? '1' : '2' },
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.group.games.at(-1).wagerUnits, currency === 'money' ? 100 : 2);
    }
  }
});

test('only creators add unique named guests without account lookup, client-chosen IDs or guest access rights', async () => {
  const { request, calls } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Guest group' } })).data.group;
  group = (await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: players[1].id } })).data.group;
  const lookups = calls.filter((entry) => entry === 'lookup').length;
  const saved = await request(`/groups/${group.id}/guests`, {
    method: 'POST', body: { name: ' Visitor ', id: owner.id, playerId: owner.id, isGuest: false },
  });
  assert.equal(saved.status, 200);
  group = saved.data.group;
  const guest = group.players.at(-1);
  assert.equal(guest.name, 'Visitor');
  assert.equal(guest.isGuest, true);
  assert.notEqual(guest.id, owner.id);
  assert.match(guest.id, /^[0-9a-f-]{36}$/);
  assert.equal(calls.filter((entry) => entry === 'lookup').length, lookups);
  assert.equal(group.ownerId, owner.id);
  assert.equal(group.canManage, true);
  assert.equal((await request(`/groups/${group.id}/guests`, { method: 'POST', actor: players[1], body: { name: 'Another guest' } })).status, 403);
  assert.equal((await request(`/groups/${group.id}/guests`, { method: 'POST', body: { name: ' visitor ' } })).status, 400);
  assert.equal((await request(`/groups/${group.id}`, { actor: guest })).status, 401);
  assert.equal((await request('/me', { actor: guest })).status, 401);
  assert.equal((await request(`/groups/${group.id}/guests`, { method: 'POST', authenticated: false, body: { name: 'Guest' } })).status, 401);
  assert.equal((await request(`/groups/${group.id}/guests`, { method: 'POST', actor: players[2], body: { name: 'Guest' } })).status, 404);
  for (const body of [{ name: ' ' }, { name: 12 }, {}]) {
    assert.equal((await request(`/groups/${group.id}/guests`, { method: 'POST', body })).status, 400);
  }
  assert.equal((await request(`/groups/${group.id}`)).data.group.players.length, 3);
  assert.equal((await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: guest.id } })).status, 404);
});

test('only creators remove unused players with a valid revision; identity lookup is not used', async () => {
  const { request, calls } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Removal group' } })).data.group;
  for (const player of players.slice(1)) {
    group = (await request(`/groups/${group.id}/players`, { method: 'POST', revision: group.revision, body: { playerId: player.id } })).data.group;
  }
  const path = `/groups/${group.id}/players/${players[4].id}`;
  const lookups = calls.filter((entry) => entry === 'lookup').length;
  assert.equal((await request(path, { method: 'DELETE', revision: group.revision, actor: players[1] })).status, 403);
  assert.equal((await request(path, { method: 'DELETE', revision: group.revision, authenticated: false })).status, 401);
  assert.equal((await request(path, { method: 'DELETE' })).status, 428);
  assert.equal((await request(path, { method: 'DELETE', revision: '0000000000000000' })).status, 412);
  assert.equal((await request(`/groups/${group.id}/players/invalid`, { method: 'DELETE', revision: group.revision })).status, 400);
  const removed = await request(path, { method: 'DELETE', revision: group.revision });
  assert.equal(removed.status, 200);
  group = removed.data.group;
  assert.equal(group.players.length, 4);
  assert.equal((await request(`/groups/${group.id}`, { actor: players[4] })).status, 404);
  assert.equal((await request(path, { method: 'DELETE', revision: group.revision })).status, 400);
  assert.equal(calls.filter((entry) => entry === 'lookup').length, lookups);
  group = (await request(`/groups/${group.id}/games`, { method: 'POST', revision: group.revision,
    body: { teamA: players.slice(0, 2).map((p) => p.id), teamB: players.slice(2, 4).map((p) => p.id), wager: '0' } })).data.group;
  assert.equal((await request(`/groups/${group.id}/players/${owner.id}`, { method: 'DELETE', revision: group.revision })).status, 400);
  group = (await request(`/groups/${group.id}/guests`, { method: 'POST', body: { name: 'Unused' } })).data.group;
  const guest = group.players.at(-1);
  const response = await request(`/groups/${group.id}/players/${guest.id}`, { method: 'DELETE', revision: group.revision });
  assert.equal(response.status, 200);
  assert.equal(response.data.group.players.length, 4);
  assert.equal(response.data.group.games.length, 1);
});

test('a guest identity cannot be treated as an authenticated account', async () => {
  let synced = false;
  const handler = createApi({ syncPlayer: async () => { synced = true; } },
    { authenticate: async () => ({ player: { ...owner, isGuest: true }, token: 'synthetic' }) }, () => {});
  const response = await handler(new Request('https://example.test/api/groups'));
  assert.equal(response.status, 403);
  assert.equal(synced, false);
});

test('profile synchronization awaits persistence and returns no account email', async () => {
  const { request, store } = fixture();
  let synced;
  store.syncPlayer = async (player) => { synced = player; return { ...player, code: 'K7M2Q9' }; };
  const response = await request('/me');
  assert.equal(response.status, 200);
  assert.deepEqual(synced, owner);
  assert.deepEqual(Object.keys(response.data.player).sort(), ['avatar', 'code', 'id', 'name']);
  assert.equal(response.data.player.code, 'K7M2Q9');
  store.syncPlayer = async () => { throw new Error('synthetic sync failure'); };
  assert.equal((await request('/me')).status, 503);
  const identity = createIdentityService('https://example.supabase.co', 'sb_publishable_synthetic',
    async () => Response.json([{ id: owner.id, display_name: 'Alex', avatar: 'fox', email: 'not-returned@example.test' }]));
  assert.deepEqual(await identity.findPlayer(owner.id, 'synthetic'), { id: owner.id, name: 'Alex', avatar: 'fox' });
});

test('creator identity comes from authentication, not submitted owner fields', async () => {
  const { request } = fixture();
  const created = await request('/groups', { method: 'POST', body: { name: ' Friends ', ownerId: players[1].id } });
  assert.equal(created.status, 201);
  assert.equal(created.data.group.ownerId, owner.id);
  assert.equal(created.data.group.name, 'Friends');
  assert.match(created.headers.get('location'), /^\/api\/groups\//);
  assert.equal(created.headers.get('etag'), `"${created.data.group.revision}"`);
  assert.equal((await request('/groups', { actor: players[1] })).data.groups.length, 0);
});

test('members add players while creator-only changes remain protected', async () => {
  const { request, calls } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Friends' } })).data.group;
  group = (await request(`/groups/${group.id}/players`, {
    method: 'POST', revision: group.revision, body: { playerId: players[1].id, name: 'Forged label' },
  })).data.group;
  assert.equal(group.players.find(player => player.id === players[1].id).name, 'Blair');
  assert.equal((await request(`/groups/${group.id}`, { actor: players[1] })).data.group.canEdit, true);
  assert.equal((await request(`/groups/${group.id}`, { actor: players[1] })).data.group.canManage, false);
  assert.equal((await request(`/groups/${group.id}`, { actor: players[2] })).status, 404);
  const before = calls.length;
  const denied = await request(`/groups/${group.id}/visibility`, {
    actor: players[1], method: 'POST', revision: group.revision, body: { isPublic: true },
  });
  assert.equal(denied.status, 403);
  assert.equal(calls.length, before);
  const added = await request(`/groups/${group.id}/players`, {
    actor: players[1], method: 'POST', revision: group.revision, body: { playerId: players[2].id },
  });
  assert.equal(added.status, 200);
  assert.ok(added.data.group.players.some((player) => player.id === players[2].id));
});

test('all game lifecycle commands use the domain rules and deletion recalculates standings', async () => {
  const { request } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Games', currency: 'money' } })).data.group;
  for (const player of players.slice(1, 4)) {
    group = (await request(`/groups/${group.id}/players`, {
      method: 'POST', revision: group.revision, body: { playerId: player.id },
    })).data.group;
  }
  const setup = { teamA: players.slice(0, 2).map((p) => p.id), teamB: players.slice(2, 4).map((p) => p.id), wager: '5' };
  assert.equal((await request(`/groups/${group.id}/games`, {
    method: 'POST', revision: group.revision, body: { ...setup, teamB: setup.teamA },
  })).status, 400);
  group = (await request(`/groups/${group.id}/games`, { method: 'POST', revision: group.revision, body: setup })).data.group;
  const gameId = group.games[0].id;
  assert.equal((await request(`/groups/${group.id}/games/${gameId}/result`, {
    method: 'POST', revision: group.revision, body: { scoreA: '11', scoreB: '11' },
  })).status, 400);
  group = (await request(`/groups/${group.id}/games/${gameId}/result`, {
    method: 'POST', revision: group.revision, body: { scoreA: '11', scoreB: '7' },
  })).data.group;
  assert.deepEqual(getStandings(group).map((row) => [row.rank, row.netUnits]), [[1, 500], [1, 500], [3, -500], [3, -500]]);
  group = (await request(`/groups/${group.id}/games/${gameId}`, { method: 'DELETE', revision: group.revision })).data.group;
  assert.ok(getStandings(group).every((row) => row.rank === null && row.netUnits === 0));
});

test('mutations reject missing revisions, invalid IDs, malformed JSON and stale versions', async () => {
  const { request, handler } = fixture();
  const group = (await request('/groups', { method: 'POST', body: { name: 'Friends' } })).data.group;
  assert.equal((await request(`/groups/${group.id}/players`, { method: 'POST', body: { playerId: owner.id } })).status, 428);
  assert.equal((await request(`/groups/${group.id}/players`, {
    method: 'POST', revision: '0000000000000000', body: { playerId: owner.id },
  })).status, 412);
  assert.equal((await request('/groups/not-an-id')).status, 400);
  assert.equal((await request('/groups', { method: 'POST', key: 'invalid', body: { name: 'Name' } })).status, 400);
  const response = await handler(new Request('https://example.test/api/groups', {
    method: 'POST', headers: { Authorization: `Bearer ${owner.id}`, 'Content-Type': 'application/json' }, body: '{bad',
  }));
  assert.equal(response.status, 400);
});

test('identity validation uses Supabase user validation and exact verified-player lookup without exposing tokens', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json(String(url).endsWith('/user')
      ? { id: owner.id, email_confirmed_at: '2026-01-01T00:00:00Z' }
      : [{ id: owner.id, display_name: 'Alex' }]);
  };
  const identity = createIdentityService('https://example.supabase.co', 'sb_publishable_synthetic', fetcher);
  assert.deepEqual(await identity.authenticate('Bearer synthetic'), { player: owner, token: 'synthetic' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic');
  assert.deepEqual(JSON.parse(requests[1].options.body), { p_player_id: owner.id });
  await assert.rejects(identity.authenticate(null), (error) => error.status === 401);
});

test('identity failures never authorize unconfirmed, unavailable, or ineligible accounts', async () => {
  for (const [response, status] of [
    [Response.json({ id: owner.id, email_confirmed_at: null }), 403],
    [Response.json({}, { status: 401 }), 401],
    [Response.json({}, { status: 500 }), 503],
  ]) {
    const identity = createIdentityService('https://example.supabase.co', 'sb_publishable_synthetic', async () => response);
    await assert.rejects(identity.authenticate('Bearer synthetic'), (error) => error.status === status);
  }
  const missing = createIdentityService('https://example.supabase.co', 'sb_publishable_synthetic', async () => Response.json([]));
  await assert.rejects(missing.findPlayer(owner.id, 'synthetic'), (error) => error.status === 404);
  const offline = createIdentityService('https://example.supabase.co', 'sb_publishable_synthetic', async () => { throw new Error('offline'); });
  await assert.rejects(offline.authenticate('Bearer synthetic'), (error) => error.status === 503);
});

test('database and provider diagnostics never include secret request details in responses or logs', async () => {
  const logs = [];
  const handler = createApi({}, { authenticate: async () => { throw new Error('synthetic-private-token'); } }, (message) => logs.push(message));
  const response = await handler(new Request('https://example.test/api/groups'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /synthetic-private-token/);
  assert.doesNotMatch(logs.join('\n'), /synthetic-private-token/);
  assert.equal(logs.length, 1);
});

test('discovery routes preserve the authenticated requester and validate search cursors', async () => {
  const { request, store } = fixture();
  const id = randomUUID();
  store.search = async (actor, query, cursor) => {
    assert.equal(actor.id, players[1].id);
    assert.equal(query, 'Friends');
    assert.equal(cursor, null);
    return { groups: [{ id, name: 'Friends', ownerName: 'Alex', memberCount: 4, relationship: 'none' }], nextCursor: null };
  };
  store.requestJoin = async (actor, groupId, key, hash) => {
    assert.equal(actor.id, players[1].id);
    assert.equal(groupId, id);
    assert.match(key, /^[0-9a-f-]{36}$/);
    assert.equal(hash.length, 64);
    return 'pending';
  };
  const search = await request('/groups/search?query=%20Friends%20', { actor: players[1] });
  assert.equal(search.status, 200);
  assert.equal(search.data.groups[0].memberCount, 4);
  assert.equal((await request('/groups/search?cursor=bad')).status, 400);
  const join = await request(`/groups/${id}/join-requests/me`, {
    actor: players[1], method: 'PUT', body: { playerId: owner.id },
  });
  assert.deepEqual(join.data, { status: 'pending' });
});

test('members can start games and record scores but cannot review requests or delete games', async () => {
  const { request } = fixture();
  let group = (await request('/groups', { method: 'POST', body: { name: 'Member rights' } })).data.group;
  for (const player of players.slice(1, 4)) group = (await request(`/groups/${group.id}/players`, {
    method: 'POST', revision: group.revision, body: { playerId: player.id },
  })).data.group;
  const setup = await request(`/groups/${group.id}/games`, {
    actor: players[1], method: 'POST', revision: group.revision,
    body: { teamA: players.slice(0, 2).map((p) => p.id), teamB: players.slice(2, 4).map((p) => p.id), wager: '0' },
  });
  assert.equal(setup.status, 200);
  group = setup.data.group;
  const result = await request(`/groups/${group.id}/games/${group.games[0].id}/result`, {
    actor: players[2], method: 'POST', revision: group.revision, body: { scoreA: '11', scoreB: '5' },
  });
  assert.equal(result.status, 200);
  group = result.data.group;
  assert.equal((await request(`/groups/${group.id}/games/${group.games[0].id}`, {
    actor: players[1], method: 'DELETE', revision: group.revision,
  })).status, 403);
  assert.equal((await request(`/groups/${group.id}/join-requests/${players[4].id}`, {
    actor: players[1], method: 'POST', revision: group.revision, body: { decision: 'approve' },
  })).status, 403);
});
