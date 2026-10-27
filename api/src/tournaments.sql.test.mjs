import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { createSqlStore } from './sqlStore.ts';
import { getStandings, ValidationError } from '../../src/domain/groups.ts';
import { canScoreTournamentMatch, currentMatchGame, getPoolStandings, getRotatingStandings, matchGameWins, tournamentPhase } from '../../src/domain/tournaments.ts';

const players = Array.from({ length: 16 }, (_, index) => ({
  id: `eeeeeeee-eeee-4eee-8eee-${String(index + 101).padStart(12, '0')}`, name: `Synthetic tournament player ${index + 1}`,
}));
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Azure SQL persists selected targets and multi-game championship results with constraints, retries and complete reset recalculation',
  { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly.');
  const pool = await adminConnection(), created = [], groupIds = [];
  const fixturePlayers = Array.from({ length: 8 }, (_, index) => ({
    id: `eeeeeeee-eeee-4eee-8eee-${String(index + 2001).padStart(12, '0')}`, name: `Synthetic scoring player ${index + 1}`,
  }));
  try {
    const store = createSqlStore(pool);
    for (const player of fixturePlayers) {
      assert.equal((await pool.request().input('id', sql.UniqueIdentifier, player.id).query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length,
        0, 'Refusing to overwrite an existing fixture ID.');
    }
    for (const player of fixturePlayers) { await store.syncPlayer(player); created.push(player); }
    let group = await store.create(fixturePlayers[0], `Synthetic scoring ${randomUUID()}`, randomUUID(), fingerprint('scoring group'));
    groupIds.push(group.id);
    for (const player of fixturePlayers.slice(1)) group = await store.change(fixturePlayers[0], group.id, group.revision,
      { type: 'add-player', playerId: player.id }, player, randomUUID(), fingerprint(player.id));
    const scoring = { pool: 15, playoff: 11, championship: 'best-of-3-11' };
    const create = { type: 'create', name: 'Configured scoring', teams: Array.from({ length: 4 },
      (_, index) => fixturePlayers.slice(index * 2, index * 2 + 2).map(player => player.id)), scoring };
    const createKey = randomUUID();
    let result = await store.changeTournament(fixturePlayers[0], group.id, null, create, createKey, fingerprint(create));
    const id = result.selectedId;
    let tournament = result.tournaments.find(tournament => tournament.id === id);
    group = result.group;
    assert.deepEqual(tournament.scoring, scoring);
    assert.equal((await store.changeTournament(fixturePlayers[0], group.id, null, create, createKey, fingerprint(create))).selectedId, id);
    async function act(action, actor = fixturePlayers[0], key = randomUUID()) {
      result = await store.changeTournament(actor, group.id, group.revision, action, key, fingerprint(action));
      group = result.group; tournament = result.tournaments.find(tournament => tournament.id === id);
    }
    async function rejectConstraint(query, gameId, constraint) {
      const tx = new sql.Transaction(pool); let rolledBack = false;
      tx.on('rollback', () => { rolledBack = true; });
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await assert.rejects(new sql.Request(tx).input('group', sql.UniqueIdentifier, group.id).input('game', sql.NVarChar(80), gameId).query(query),
          error => (error.number === 547 || error.number === 2601 || error.number === 2627) && error.message.includes(constraint));
      } finally { if (!rolledBack) await tx.rollback(); }
    }
    await rejectConstraint("UPDATE dbo.Games SET status = 'completed', score_a = 11, score_b = 7 WHERE group_id = @group AND id = @game;",
      tournament.pool[0].gameId, 'CK_TournamentScore');
    await rejectConstraint('UPDATE dbo.Games SET tournament_game_number = 1 WHERE group_id = @group AND id = @game;',
      tournament.pool[0].gameId, 'CK_TournamentFormat');
    for (const match of tournament.pool) await act({ type: 'score', id, matchId: match.id, gameId: match.gameId, scoreA: '15', scoreB: '7' }, fixturePlayers[1]);
    await act({ type: 'start-playoffs', id, seeds: getPoolStandings(group, tournament).map(row => row.teamId) });
    while (tournament.playoffs.some(match => match.stage === 'playoff' && canScoreTournamentMatch(group, tournament, match))) {
      const match = tournament.playoffs.find(match => match.stage === 'playoff' && canScoreTournamentMatch(group, tournament, match));
      await act({ type: 'score', id, matchId: match.id, gameId: match.gameId, scoreA: '11', scoreB: '7' }, fixturePlayers[1]);
    }
    const baseline = getStandings(group);
    let final = tournament.playoffs.at(-1);
    const first = { type: 'score', id, matchId: final.id, gameId: currentMatchGame(group, final).id, scoreA: '11', scoreB: '7' };
    const firstKey = randomUUID(), firstRevision = group.revision;
    await act(first, fixturePlayers[1], firstKey); final = tournament.playoffs.at(-1);
    assert.deepEqual(matchGameWins(group, final), { a: 1, b: 0 });
    const replay = await store.changeTournament(fixturePlayers[1], group.id, firstRevision, first, firstKey, fingerprint(first));
    assert.equal(replay.group.revision, group.revision);
    assert.deepEqual(replay.tournaments.find(tournament => tournament.id === id).playoffs.at(-1).gameIds, final.gameIds);
    await assert.rejects(store.changeTournament(fixturePlayers[1], group.id, group.revision, first, randomUUID(), fingerprint(first)), /another game/);
    await rejectConstraint('UPDATE dbo.Games SET tournament_game_number = 1 WHERE group_id = @group AND id = @game;',
      currentMatchGame(group, final).id, 'UQ_TournamentGame');
    await rejectConstraint('UPDATE dbo.Games SET tournament_target = NULL WHERE group_id = @group AND id = @game;',
      currentMatchGame(group, final).id, 'CK_TournamentFormat');
    await act({ type: 'score', id, matchId: final.id, gameId: currentMatchGame(group, final).id, scoreA: '7', scoreB: '11' }, fixturePlayers[1]);
    final = tournament.playoffs.at(-1);
    await act({ type: 'score', id, matchId: final.id, gameId: currentMatchGame(group, final).id, scoreA: '12', scoreB: '10' }, fixturePlayers[1]);
    final = tournament.playoffs.at(-1);
    assert.equal(tournamentPhase(group, tournament), 'completed');
    assert.deepEqual(matchGameWins(group, final), { a: 2, b: 1 });
    assert.equal(tournament.completedAt, currentMatchGame(group, final).completedAt);
    assert.deepEqual(group.games.filter(game => final.gameIds.includes(game.id)).map(game => game.tournament.gameNumber), [1, 2, 3]);
    const readback = await createSqlStore(pool).tournaments(fixturePlayers[1], group.id);
    assert.deepEqual(readback.tournaments.find(tournament => tournament.id === id), tournament);
    assert.deepEqual(readback.group.games, group.games);
    const count = group.nextGameNumber;
    await act({ type: 'reset-result', id, matchId: final.id });
    final = tournament.playoffs.at(-1);
    assert.deepEqual(getStandings(group), baseline);
    assert.equal(group.nextGameNumber, count); assert.equal(final.gameIds.length, 1);
    assert.equal(tournament.completedAt, null);
    for (let index = 0; index < 2; index++) {
      await act({ type: 'score', id, matchId: final.id, gameId: currentMatchGame(group, final).id, scoreA: '11', scoreB: '7' });
      final = tournament.playoffs.at(-1);
    }
    assert.equal(final.gameIds.length, 2);
    assert.equal(tournamentPhase(group, tournament), 'completed');
    const fixedGames = structuredClone(group.games);
    const rotation = { type: 'create', style: 'rotating-partner-round-robin', name: 'Rotation 15',
      players: fixturePlayers.slice(0, 4).map(player => player.id), scoring: { pool: 15, playoff: 15, championship: 'single-15' } };
    let rotatingResult = await store.changeTournament(fixturePlayers[0], group.id, null, rotation, randomUUID(), fingerprint(rotation));
    const rotatingId = rotatingResult.selectedId;
    group = rotatingResult.group;
    const scheduled = rotatingResult.tournaments.find(tournament => tournament.id === rotatingId).pool;
    for (const match of scheduled) {
      const action = { type: 'score', id: rotatingId, matchId: match.id, gameId: match.gameId, scoreA: '15', scoreB: '13' };
      rotatingResult = await store.changeTournament(fixturePlayers[1], group.id, group.revision, action, randomUUID(), fingerprint(action));
      group = rotatingResult.group;
    }
    assert.equal(tournamentPhase(group, rotatingResult.tournaments.find(tournament => tournament.id === rotatingId)), 'completed');
    assert.deepEqual(group.games.filter(game => game.tournament.id === id), fixedGames);
  } finally {
    try { await cleanupFixtures(pool, groupIds, created.map(player => player.id)); }
    finally { await pool.close(); }
  }
});

test('Azure SQL persists bounded tournaments, blocks bypasses, and resets playoff statistics atomically', { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly.');
  const pool = await adminConnection();
  const created = [];
  let groupId;
  let secondPool;
  try {
    for (const player of players) {
      const existing = await pool.request().input('id', sql.UniqueIdentifier, player.id).query('SELECT id FROM dbo.Players WHERE id = @id;');
      assert.equal(existing.recordset.length, 0, 'Refusing to overwrite an existing fixture ID.');
    }
    const store = createSqlStore(pool);
    for (const player of players) { await store.syncPlayer(player); created.push(player); }
    let group = await store.create(players[0], `Synthetic tournament ${randomUUID()}`, randomUUID(), fingerprint('create group'));
    groupId = group.id;
    for (const player of players.slice(1)) {
      const command = { type: 'add-player', playerId: player.id };
      group = await store.change(players[0], group.id, group.revision, command, player, randomUUID(), fingerprint(command));
    }
    const pairs = Array.from({ length: 8 }, (_, index) => players.slice(index * 2, index * 2 + 2).map((p) => p.id));
    const create = { type: 'create', name: 'Eight team cup', teams: pairs };
    await assert.rejects(store.changeTournament(players[1], group.id, null, create, randomUUID(), fingerprint(create)), (error) => error.status === 403);
    const key = randomUUID();
    let result = await store.changeTournament(players[0], group.id, null, create, key, fingerprint(create));
    group = result.group;
    const id = result.selectedId;
    let tournament = result.tournaments.find((entry) => entry.id === id);
    assert.equal(tournament.pool.length, 28);
    assert.equal(group.games.length, 28);
    const tournamentCreatedAt = tournament.createdAt;
    assert.equal(new Date(tournamentCreatedAt).toISOString(), tournamentCreatedAt);
    assert.equal(tournament.completedAt, null);
    const poolCreatedAt = new Map(group.games.map((game) => [game.id, game.createdAt]));
    assert.ok(group.games.every((game) => game.createdAt >= tournamentCreatedAt && game.completedAt === null));
    assert.equal(new Set(group.games.map((game) => game.id)).size, 28);
    assert.equal((await store.changeTournament(players[0], group.id, null, create, key, fingerprint(create))).selectedId, id);
    await assert.rejects(store.change(players[0], group.id, group.revision,
      { type: 'record-result', gameId: tournament.pool[0].gameId, scoreA: '1', scoreB: '0' }, null, randomUUID(), fingerprint('bypass')), (error) => error.status === 409);
    await assert.rejects(store.change(players[0], group.id, group.revision,
      { type: 'delete-game', gameId: tournament.pool[0].gameId }, null, randomUUID(), fingerprint('delete bypass')), (error) => error.status === 409);
    async function act(action, actor = players[0]) {
      result = await store.changeTournament(actor, group.id, group.revision, action, randomUUID(), fingerprint(action));
      group = result.group;
      tournament = result.tournaments.find((entry) => entry.id === id);
    }
    const invalid = { type: 'score', id, matchId: tournament.pool[0].id, scoreA: '11', scoreB: '10' };
    await assert.rejects(store.changeTournament(players[1], group.id, group.revision, invalid, randomUUID(), fingerprint(invalid)), ValidationError);
    assert.equal((await store.get(players[0], group.id)).revision, group.revision);
    const constraintTest = new sql.Transaction(pool);
    let constraintRolledBack = false;
    constraintTest.on('rollback', () => { constraintRolledBack = true; });
    await constraintTest.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await assert.rejects(new sql.Request(constraintTest).input('group', sql.UniqueIdentifier, group.id)
        .input('game', sql.NVarChar(80), tournament.pool[0].gameId)
        .query("UPDATE dbo.Games SET status = 'completed', score_a = 11, score_b = 10 WHERE group_id = @group AND id = @game;"),
      (error) => error.number === 547 && error.message.includes('CK_TournamentScore'));
    } finally {
      if (!constraintRolledBack) await constraintTest.rollback();
    }
    const firstMatch = tournament.pool[0];
    const concurrentAction = { type: 'score', id, matchId: firstMatch.id, scoreA: '11', scoreB: '7' };
    const concurrent = await Promise.allSettled([
      store.changeTournament(players[1], group.id, group.revision, concurrentAction, randomUUID(), fingerprint(concurrentAction)),
      store.changeTournament(players[2], group.id, group.revision, concurrentAction, randomUUID(), fingerprint(concurrentAction)),
    ]);
    assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((entry) => entry.status === 'rejected').reason.status, 412);
    result = concurrent.find((entry) => entry.status === 'fulfilled').value;
    group = result.group;
    tournament = result.tournaments.find((entry) => entry.id === id);
    for (const match of tournament.pool) {
      if (group.games.find((game) => game.id === match.gameId).status === 'completed') continue;
      const aWins = Number(match.teamA.split('-')[1]) < Number(match.teamB.split('-')[1]);
      await act({ type: 'score', id, matchId: match.id, scoreA: aWins ? '11' : '7', scoreB: aWins ? '7' : '11' }, players[1]);
    }
    const poolStandings = getStandings(group);
    const seeds = getPoolStandings(group, tournament).map((row) => row.teamId);
    await act({ type: 'start-playoffs', id, seeds });
    for (let index = 0; tournamentPhase(group, tournament) !== 'completed'; index++) {
      assert.ok(index < 8);
      const match = tournament.playoffs.find((match) => group.games.find((game) => game.id === match.gameId)?.status === 'pending');
      await act({ type: 'score', id, matchId: match.id, scoreA: '15', scoreB: '9' }, players[2]);
    }
    assert.equal(group.games.length, 35);
    const final = tournament.playoffs.at(-1);
    const finalGame = group.games.find((game) => game.id === final.gameId);
    assert.equal(tournament.completedAt, finalGame.completedAt);
    assert.equal(tournament.createdAt, tournamentCreatedAt);
    assert.ok(group.games.every((game) => game.completedAt >= game.createdAt && game.createdAt !== null));
    secondPool = await adminConnection();
    const durable = await createSqlStore(secondPool).tournaments(players[1], group.id);
    assert.equal(tournamentPhase(durable.group, durable.tournaments[0]), 'completed');
    assert.ok(durable.group.games.every((game) => game.wagerUnits === 0));
    assert.deepEqual(durable.group.games, group.games);
    assert.equal(durable.tournaments[0].completedAt, tournament.completedAt);
    await act({ type: 'reset-result', id, matchId: final.id });
    assert.equal(tournament.completedAt, null);
    assert.equal(tournament.createdAt, tournamentCreatedAt);
    assert.equal(group.games.find((game) => game.id === final.gameId).createdAt, finalGame.createdAt);
    assert.equal(group.games.find((game) => game.id === final.gameId).completedAt, null);
    await act({ type: 'score', id, matchId: final.id, scoreA: '15', scoreB: '9' });
    assert.ok(tournament.completedAt >= finalGame.completedAt);
    assert.equal(tournament.completedAt, group.games.find((game) => game.id === final.gameId).completedAt);
    await assert.rejects(store.changeTournament(players[1], group.id, group.revision,
      { type: 'reset-playoffs', id }, randomUUID(), fingerprint('forbidden reset')), (error) => error.status === 403);
    const counter = group.nextGameNumber;
    const before = group.revision;
    await act({ type: 'reset-playoffs', id });
    assert.equal(group.games.length, 28);
    assert.equal(tournament.completedAt, null);
    assert.equal(tournament.createdAt, tournamentCreatedAt);
    assert.ok(group.games.every((game) => game.createdAt === poolCreatedAt.get(game.id)));
    assert.equal(group.nextGameNumber, counter);
    assert.deepEqual(getStandings(group), poolStandings);
    await assert.rejects(store.changeTournament(players[0], group.id, before,
      { type: 'start-playoffs', id, seeds }, randomUUID(), fingerprint('stale')), (error) => error.status === 412);
    await act({ type: 'reset-result', id, matchId: tournament.pool[0].id });
    assert.equal(tournamentPhase(group, tournament), 'pool');
    assert.equal(group.games.find((game) => game.id === tournament.pool[0].gameId).completedAt, null);
    assert.equal((await createSqlStore(secondPool).tournaments(players[1], group.id)).group.games.filter((game) => game.status === 'completed').length, 27);

    const fixedGames = structuredClone(group.games);
    for (const count of [4, 8]) {
      const rotatingCreate = { type: 'create', style: 'rotating-partner-round-robin',
        name: `Synthetic ${count} player rotation`, players: players.slice(0, count).map(player => player.id) };
      const rotatingKey = randomUUID();
      let rotatingResult = await store.changeTournament(players[0], group.id, null, rotatingCreate, rotatingKey, fingerprint(rotatingCreate));
      group = rotatingResult.group;
      const rotatingId = rotatingResult.selectedId;
      let rotating = rotatingResult.tournaments.find(entry => entry.id === rotatingId);
      const scheduled = structuredClone(rotating.pool);
      const createdAt = rotating.createdAt;
      assert.equal(rotating.pool.length, count * (count - 1) / 4);
      assert.equal(new Set(rotating.teams.map(team => [...team.players].sort().join('|'))).size, count * (count - 1) / 2);
      assert.deepEqual(rotating.playoffs, []);
      assert.deepEqual(rotating.seeds, []);
      assert.equal((await store.changeTournament(players[0], group.id, null, rotatingCreate, rotatingKey, fingerprint(rotatingCreate))).selectedId, rotatingId);
      const beforeScoring = group.revision;
      async function rotate(action, actor = players[1]) {
        rotatingResult = await store.changeTournament(actor, group.id, group.revision, action, randomUUID(), fingerprint(action));
        group = rotatingResult.group;
        rotating = rotatingResult.tournaments.find(entry => entry.id === rotatingId);
      }
      const future = scheduled.find(match => match.round === 2);
      await assert.rejects(rotate({ type: 'score', id: rotatingId, matchId: future.id, scoreA: '11', scoreB: '7' }), /pool round 1/);
      assert.equal((await createSqlStore(secondPool).tournaments(players[1], group.id)).group.revision, beforeScoring);
      const scoringOrder = [...scheduled].reverse().sort((a, b) => a.round - b.round);
      for (const match of scoringOrder) {
        await rotate({ type: 'score', id: rotatingId, matchId: match.id, scoreA: '11', scoreB: '7' });
      }
      assert.equal(tournamentPhase(group, rotating), 'completed');
      assert.equal(rotating.completedAt, group.games.find(game => game.id === scoringOrder.at(-1).gameId).completedAt);
      assert.ok(rotating.completedAt);
      assert.ok(getRotatingStandings(group, rotating).every(row => row.wins + row.losses === count - 1 && row.netUnits === 0));
      const reread = await createSqlStore(secondPool).tournaments(players[1], group.id);
      assert.deepEqual(reread.tournaments.find(entry => entry.id === rotatingId), rotating);
      assert.deepEqual(reread.group.games, group.games);
      assert.ok(group.games.every(game => game.wagerUnits === 0));
      assert.deepEqual(group.games.filter(game => game.tournament.id === id), fixedGames);
      const clear = { type: 'reset-result', id: rotatingId, matchId: scheduled[0].id };
      await assert.rejects(store.changeTournament(players[0], group.id, beforeScoring, clear, randomUUID(), fingerprint(clear)), error => error.status === 412);
      await assert.rejects(store.changeTournament(players[1], group.id, group.revision, clear, randomUUID(), fingerprint(clear)), error => error.status === 403);
      for (const action of [{ type: 'start-playoffs', id: rotatingId, seeds: [] }, { type: 'reset-playoffs', id: rotatingId }]) {
        await assert.rejects(store.changeTournament(players[0], group.id, group.revision, action, randomUUID(), fingerprint(action)), ValidationError);
      }
      const previousGames = group.games;
      const nextGameNumber = group.nextGameNumber;
      await rotate(clear, players[0]);
      assert.equal(tournamentPhase(group, rotating), 'pool');
      assert.equal(rotating.completedAt, null);
      assert.equal(rotating.createdAt, createdAt);
      assert.equal(group.nextGameNumber, nextGameNumber);
      assert.deepEqual(rotating.pool, scheduled);
      assert.deepEqual(group.games.filter(game => game.id !== scheduled[0].gameId), previousGames.filter(game => game.id !== scheduled[0].gameId));
      const pending = await createSqlStore(secondPool).tournaments(players[1], group.id);
      assert.equal(pending.tournaments.find(entry => entry.id === rotatingId).completedAt, null);
      await rotate({ type: 'score', id: rotatingId, matchId: scheduled[0].id, scoreA: '7', scoreB: '11' });
      assert.equal(tournamentPhase(group, rotating), 'completed');
    }
  } finally {
    if (secondPool) await secondPool.close();
    try { await cleanupFixtures(pool, groupId ? [groupId] : [], created.map((player) => player.id)); }
    finally { await pool.close(); }
  }
});
