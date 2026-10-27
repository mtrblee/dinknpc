import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApi } from './api.ts';
import { ApiError, applyCommand } from './contracts.ts';
import { addPlayer, createGroup } from '../../src/domain/groups.ts';
import { changeTournament, createRotatingTournament, createTournament, getRotatingStandings, tournamentPhase } from '../../src/domain/tournaments.ts';

function fixture(admin = false, participantCount = 4) {
  const players = Array.from({ length: participantCount + 1 }, (_, index) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`, name: `Player ${index}` }));
  let group = { ...createGroup([], 'Tournament API'), id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    ownerId: players[0].id, ownerName: players[0].name, canEdit: true, canManage: true, isOwner: true,
    adminIds: admin ? [players[1].id] : [], isPublic: false, revision: '0000000000000001' };
  for (const player of players.slice(0, participantCount)) group = addPlayer(group, player);
  let tournament;
  let mutations = 0;
  const project = (actor) => ({ ...group, isOwner: actor.id === players[0].id,
    canManage: actor.id === players[0].id || group.adminIds.includes(actor.id) });
  const store = {
    syncPlayer: async () => {},
    get: async (actor) => {
      if (!group.players.some((player) => player.id === actor.id)) throw new ApiError(404, 'group_not_found', 'Not found.');
      return project(actor);
    },
    tournaments: async (actor) => ({ group: await store.get(actor), tournaments: tournament ? [tournament] : [] }),
    change: async (actor, _id, _revision, command) => ({ ...applyCommand(await store.get(actor), command, null) }),
    changeTournament: async (actor, _id, revision, action) => {
      const visible = await store.get(actor);
      assert.ok(action.type === 'score' || visible.canManage);
      if (action.type === 'create') assert.equal(revision, null);
      mutations++;
      const result = action.type === 'create'
        ? action.style === 'rotating-partner-round-robin'
          ? createRotatingTournament(visible, 'cccccccc-cccc-4ccc-8ccc-000000000001', action.name, action.players, action.scoring)
          : createTournament(visible, 'cccccccc-cccc-4ccc-8ccc-000000000001', action.name, action.teams, action.scoring)
        : changeTournament(visible, tournament, action);
      group = result.group;
      tournament = result.tournament;
      return { group: project(actor), tournaments: [tournament], selectedId: tournament.id };
    },
  };
  const identity = {
    authenticate: async (header) => {
      const player = players.find((player) => header === `Bearer ${player.id}`);
      if (!player) throw new ApiError(401, 'unauthorized', 'Log in.');
      return { player, token: 'synthetic' };
    },
  };
  const api = createApi(store, identity, () => {});
  const base = `/groups/${group.id}/tournaments`;
  async function request(path, method = 'GET', body, actor = players[0]) {
    const response = await api(new Request(`https://example.test/api${path}`, {
      method, headers: { ...(actor ? { Authorization: `Bearer ${actor.id}` } : {}), 'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(), ...(path === base && method === 'POST' ? {} : { 'If-Match': `"${group.revision}"` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  }
  const setup = { name: 'Cup', style: 'fixed-round-robin', teams: [players.slice(0, 2).map((p) => p.id), players.slice(2, 4).map((p) => p.id)] };
  return { request, base, setup, players, group: () => group, tournament: () => tournament, mutations: () => mutations };
}

test('admins can create both tournament formats and correct results without becoming owners', async () => {
  for (const rotating of [false, true]) {
    const f = fixture(true), admin = f.players[1];
    const body = rotating ? { name: 'Admin rotation', style: 'rotating-partner-round-robin', players: f.players.slice(0, 4).map(p => p.id) } : f.setup;
    const created = await f.request(f.base, 'POST', body, admin);
    assert.equal(created.status, 201);
    assert.equal(created.data.group.isOwner, false);
    assert.equal(created.data.group.canManage, true);
    const tournament = f.tournament(), match = tournament.pool[0];
    const resultPath = `${f.base}/${tournament.id}/matches/${match.id}/result`;
    assert.equal((await f.request(resultPath, 'POST', { scoreA: '11', scoreB: '7' }, admin)).status, 200);
    assert.equal((await f.request(resultPath, 'DELETE', undefined, admin)).status, 200);
  }
});

test('configured creation preserves stage choices and series scoring requires the exact next game without relaxing permissions', async () => {
  const f = fixture(true), path = `${f.base}/configured`;
  const scoring = { pool: 15, playoff: 11, championship: 'best-of-3-11' };
  assert.equal((await f.request(path, 'POST', { ...f.setup, scoring }, f.players[2])).status, 403);
  assert.equal((await f.request(path, 'POST', f.setup)).status, 400);
  assert.equal((await f.request(path, 'POST', { ...f.setup, scoring: { ...scoring, pool: 'best-of-3-11' } })).status, 400);
  assert.equal(f.mutations(), 0);
  const created = await f.request(path, 'POST', { ...f.setup, scoring }, f.players[1]);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.tournaments[0].scoring, scoring);
  const id = f.tournament().id, poolMatch = f.tournament().pool[0];
  const poolPath = `${f.base}/${id}/matches/${poolMatch.id}/result`;
  assert.equal((await f.request(poolPath, 'POST', { scoreA: '11', scoreB: '7' })).status, 400);
  assert.equal((await f.request(poolPath, 'POST', { scoreA: '15', scoreB: '7' })).status, 200);
  assert.equal((await f.request(`${f.base}/${id}/playoffs`, 'POST', { seeds: ['team-1', 'team-2'] })).status, 200);
  const finalPath = `${f.base}/${id}/matches/${f.tournament().playoffs[0].id}/result`;
  const firstId = f.tournament().playoffs[0].gameId;
  assert.equal((await f.request(finalPath, 'POST', { scoreA: '11', scoreB: '7' })).status, 400);
  assert.equal((await f.request(finalPath, 'POST', { gameId: firstId, scoreA: '11', scoreB: '7' }, f.players[2])).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'playoffs');
  assert.equal((await f.request(finalPath, 'POST', { gameId: firstId, scoreA: '11', scoreB: '7' })).status, 400);
  const secondId = f.tournament().playoffs[0].gameIds[1];
  assert.equal((await f.request(finalPath, 'POST', { gameId: secondId, scoreA: '11', scoreB: '9' })).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'completed');
  assert.equal(f.tournament().playoffs[0].gameIds.length, 2);
  assert.equal((await f.request(finalPath, 'DELETE', undefined, f.players[2])).status, 403);
  assert.equal((await f.request(finalPath, 'DELETE', undefined, f.players[1])).status, 200);
  assert.equal(f.tournament().playoffs[0].gameIds.length, 1);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'playoffs');
});

test('configured rotating tournaments accept 15-point single games but never a best-of-three pool', async () => {
  const f = fixture();
  const setup = { name: 'Rotation 15', style: 'rotating-partner-round-robin', players: f.players.slice(0, 4).map(player => player.id),
    scoring: { pool: 15, playoff: 15, championship: 'single-15' } };
  assert.equal((await f.request(`${f.base}/configured`, 'POST', { ...setup, scoring: { ...setup.scoring, pool: 'best-of-3-11' } })).status, 400);
  assert.equal((await f.request(`${f.base}/configured`, 'POST', setup)).status, 201);
  const tournament = f.tournament();
  for (const match of tournament.pool) assert.equal((await f.request(`${f.base}/${tournament.id}/matches/${match.id}/result`,
    'POST', { gameId: match.gameId, scoreA: '15', scoreB: '10' }, f.players[1])).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'completed');
});

test('tournament access requires membership and ordinary members cannot create/manage', async () => {
  const f = fixture();
  assert.equal((await f.request(f.base, 'GET', undefined, null)).status, 401);
  assert.equal((await f.request(f.base, 'GET', undefined, f.players[4])).status, 404);
  assert.equal((await f.request(f.base, 'POST', f.setup, f.players[1])).status, 403);
  assert.equal(f.mutations(), 0);
  assert.equal((await f.request(f.base, 'POST', { ...f.setup, wager: '5' })).status, 400);
  assert.equal((await f.request(f.base, 'POST', { ...f.setup, wagerCents: 0 })).status, 400);
  assert.equal((await f.request(f.base, 'POST', { ...f.setup, wagerUnits: 0 })).status, 400);
  assert.equal((await f.request(f.base, 'POST', { ...f.setup, style: 'unsupported' })).status, 400);
  assert.equal((await f.request(f.base, 'POST', f.setup)).status, 201);
  const id = f.tournament().id;
  assert.equal((await f.request(`${f.base}/${id}/playoffs`, 'POST', { seeds: ['team-1', 'team-2'] }, f.players[1])).status, 403);
  assert.equal((await f.request(`${f.base}/${id}/playoffs`, 'DELETE', undefined, f.players[1])).status, 403);
  assert.equal((await f.request(`${f.base}/${id}/matches/${f.tournament().pool[0].id}/result`, 'DELETE', undefined, f.players[1])).status, 403);
});

test('members score valid tournament matches but ordinary game endpoints cannot bypass rules', async () => {
  const f = fixture();
  await f.request(f.base, 'POST', f.setup);
  const tournament = f.tournament();
  const match = tournament.pool[0];
  const generic = `/groups/${f.group().id}/games/${match.gameId}`;
  assert.equal((await f.request(`${generic}/result`, 'POST', { scoreA: '11', scoreB: '7' }, f.players[1])).status, 409);
  assert.equal((await f.request(generic, 'DELETE')).status, 409);
  const poolPath = `${f.base}/${tournament.id}/matches/${match.id}/result`;
  assert.equal((await f.request(poolPath, 'POST', { scoreA: '1', scoreB: '0' }, f.players[1])).status, 400);
  assert.equal((await f.request(poolPath, 'POST', { scoreA: '11', scoreB: '7' }, f.players[1])).status, 200);
  assert.equal((await f.request(`${f.base}/${tournament.id}/playoffs`, 'POST', { seeds: ['team-1', 'team-2'] })).status, 200);
  const final = f.tournament().playoffs[0];
  const finalPath = `${f.base}/${tournament.id}/matches/${final.id}/result`;
  assert.equal((await f.request(finalPath, 'POST', { scoreA: '11', scoreB: '7' }, f.players[2])).status, 400);
  assert.equal((await f.request(finalPath, 'POST', { scoreA: '17', scoreB: '15' }, f.players[2])).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'completed');
  assert.ok(f.group().games.every((game) => game.wagerUnits === 0));
  assert.equal((await f.request(`${f.base}/${tournament.id}/playoffs`, 'DELETE')).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'ready');
  assert.equal(f.group().games.length, 1);
});

test('pool round locks reject owner, admin and member scores until every earlier game is complete', async () => {
  for (const rotating of [false, true]) {
    const f = fixture(true, 8);
    const participants = f.players.slice(0, 8);
    const setup = rotating
      ? { name: 'Sequential rotation', style: 'rotating-partner-round-robin', players: participants.map(player => player.id) }
      : { ...f.setup, teams: Array.from({ length: 4 }, (_, index) => participants.slice(index * 2, index * 2 + 2).map(player => player.id)) };
    assert.equal((await f.request(f.base, 'POST', setup)).status, 201);
    const tournament = f.tournament();
    const route = match => `${f.base}/${tournament.id}/matches/${match.id}/result`;
    const firstRound = tournament.pool.filter(match => match.round === 1).reverse();
    const nextRound = tournament.pool.filter(match => match.round === 2);
    const result = { scoreA: '11', scoreB: '7' };
    async function assertLocked(match) {
      const before = JSON.stringify([f.group(), f.tournament()]);
      for (const actor of f.players.slice(0, 3)) {
        const response = await f.request(route(match), 'POST', result, actor);
        assert.equal(response.status, 400);
        assert.match(response.data.error.message, /pool round 1/);
        assert.equal(JSON.stringify([f.group(), f.tournament()]), before);
        assert.equal((await f.request(`/groups/${f.group().id}/games/${match.gameId}/result`, 'POST', result, actor)).status, 409);
      }
    }
    await assertLocked(nextRound[0]);
    assert.equal((await f.request(route(firstRound[0]), 'POST', result, f.players[2])).status, 200);
    await assertLocked(nextRound[0]);
    assert.equal((await f.request(route(firstRound[1]), 'POST', result, f.players[2])).status, 200);
    assert.equal((await f.request(route(nextRound[0]), 'POST', result, f.players[2])).status, 200);
    const savedLater = f.group().games.find(game => game.id === nextRound[0].gameId);
    assert.equal((await f.request(route(firstRound[0]), 'DELETE', undefined, f.players[1])).status, 200);
    await assertLocked(nextRound[1]);
    assert.deepEqual(f.group().games.find(game => game.id === savedLater.id), savedLater);
    assert.equal((await f.request(route(firstRound[0]), 'POST', result, f.players[0])).status, 200);
    assert.equal((await f.request(route(nextRound[1]), 'POST', result, f.players[2])).status, 200);
  }
});

test('rotating tournament endpoints validate participants, preserve owner permissions and complete without playoffs', async () => {
  const f = fixture();
  const setup = { name: 'Rotating cup', style: 'rotating-partner-round-robin', players: f.players.slice(0, 4).map(p => p.id) };
  assert.equal((await f.request(f.base, 'POST', setup, f.players[1])).status, 403);
  for (const invalid of [
    { ...setup, players: setup.players.slice(0, 3) },
    { ...setup, players: [setup.players[0], ...setup.players.slice(0, 3)] },
    { ...setup, players: [...setup.players.slice(0, 3), f.players[4].id] },
    { ...setup, players: [42, ...setup.players.slice(1)] },
    { ...setup, teams: f.setup.teams }, { ...setup, wagerUnits: 0 },
  ]) assert.equal((await f.request(f.base, 'POST', invalid)).status, 400);
  assert.equal((await f.request(f.base, 'POST', setup)).status, 201);
  const tournament = f.tournament();
  assert.equal(tournament.pool.length, 3);
  for (const match of tournament.pool) {
    const route = `${f.base}/${tournament.id}/matches/${match.id}/result`;
    assert.equal((await f.request(route, 'POST', { scoreA: '11', scoreB: '10' }, f.players[1])).status, 400);
    assert.equal((await f.request(route, 'POST', { scoreA: '11', scoreB: '7' }, f.players[1])).status, 200);
  }
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'completed');
  assert.ok(getRotatingStandings(f.group(), f.tournament()).every(row => row.wins + row.losses === 3 && row.netUnits === 0));
  assert.equal((await f.request(`${f.base}/${tournament.id}/playoffs`, 'POST', { seeds: [] })).status, 400);
  assert.equal((await f.request(`${f.base}/${tournament.id}/playoffs`, 'DELETE')).status, 400);
  const reset = `${f.base}/${tournament.id}/matches/${tournament.pool[0].id}/result`;
  assert.equal((await f.request(reset, 'DELETE', undefined, f.players[1])).status, 403);
  assert.equal((await f.request(reset, 'DELETE')).status, 200);
  assert.equal(tournamentPhase(f.group(), f.tournament()), 'pool');
});
