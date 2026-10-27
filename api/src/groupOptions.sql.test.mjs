import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { createSqlStore } from './sqlStore.ts';
import { getStandings, ValidationError } from '../../src/domain/groups.ts';
import { GROUP_AVATARS, GroupAvatarError } from '../../src/domain/groupAvatars.ts';
import { summarizeGroup } from '../../src/types/api.ts';

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('group currencies and independent avatars persist with owner-only changes and safe retries', { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly for the development database test.');
  const pool = await adminConnection();
  const actors = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), name: `Synthetic options ${index}`, avatar: 'fox' }));
  const groupIds = [];
  const playerIds = [];
  let otherPool;
  try {
    const store = createSqlStore(pool);
    for (const actor of actors) {
      const existing = await pool.request().input('id', sql.UniqueIdentifier, actor.id).query('SELECT id FROM dbo.Players WHERE id = @id;');
      assert.equal(existing.recordset.length, 0, 'Refusing to overwrite an existing identity.');
      await store.syncPlayer(actor);
      playerIds.push(actor.id);
    }
    otherPool = await adminConnection();
    const reader = createSqlStore(otherPool);
    const legacyId = randomUUID();
    await pool.request().input('id', sql.UniqueIdentifier, legacyId).input('owner', sql.UniqueIdentifier, actors[0].id)
      .query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED; INSERT dbo.Groups(id, owner_id, name) VALUES (@id, @owner, N'Synthetic legacy defaults');");
    groupIds.push(legacyId);
    const legacy = await reader.get(actors[0], legacyId);
    assert.equal(legacy.currency, 'money', 'Legacy SQL defaults preserve USD interpretation.');
    assert.equal(legacy.avatar, 'paddles');
    assert.deepEqual(await reader.summaries(actors[1]), [], 'Private groups are not disclosed to nonmembers.');
    assert.deepEqual(await reader.summaries(actors[0]), [summarizeGroup(legacy)], 'An owner without roster membership sees the group once.');

    for (const [currency, wager, units] of [['none', '', 0], ['money', '1', 100], ['boba', '2', 2]]) {
      const key = randomUUID();
      const name = `Synthetic options ${randomUUID()}`;
      const creation = fingerprint([name, currency, 'paddles']);
      let group = currency === 'none'
        ? await store.create(actors[0], name, key, creation)
        : await store.create(actors[0], name, key, creation, currency);
      groupIds.push(group.id);
      assert.equal(group.currency, currency);
      assert.equal((await store.create(actors[0], name, key, creation, currency)).id, group.id);
      await assert.rejects(store.create(actors[0], name, key, fingerprint([name, currency, 'trophy']), currency, 'trophy'),
        (error) => error.status === 409);
      for (const actor of actors.slice(1)) {
        const command = { type: 'add-player', playerId: actor.id };
        group = await store.change(actors[0], group.id, group.revision, command, actor, randomUUID(), fingerprint(command));
      }
      const change = async (command) => {
        group = await store.change(actors[0], group.id, group.revision, command, null, randomUUID(), fingerprint(command));
      };
      const setup = { type: 'start-game', teamA: actors.slice(0, 2).map((actor) => actor.id),
        teamB: actors.slice(2).map((actor) => actor.id), wager };
      const invalid = currency === 'none' ? ['1'] : currency === 'money' ? ['0.01', '0.99', '1.25', '1.00'] : ['1.5'];
      for (const value of invalid) await assert.rejects(change({ ...setup, wager: value }), ValidationError);
      assert.equal((await reader.get(actors[0], group.id)).games.length, 0);
      await change(setup);
      assert.equal((await reader.summaries(actors[0])).find((entry) => entry.id === group.id).completedGameCount, 0);
      assert.equal((await reader.summaries(actors[0])).find((entry) => entry.id === group.id).latestCompletedAt, null);
      await change({ type: 'record-result', gameId: group.games[0].id, scoreA: '11', scoreB: '7' });
      assert.equal(group.games[0].wagerUnits, units);
      const games = group.games;
      const roster = group.players;
      const standings = getStandings(group);
      assert.ok(standings.every((row) => Math.abs(row.netUnits) === units));
      assert.equal(standings.reduce((sum, row) => sum + row.netUnits, 0), 0);
      const avatarChange = { type: 'set-avatar', avatar: 'island' };
      await assert.rejects(store.change(actors[1], group.id, group.revision, avatarChange, null, randomUUID(), fingerprint(avatarChange)),
        (error) => error.status === 403);
      await assert.rejects(change({ type: 'set-avatar', avatar: 'smile' }), GroupAvatarError);
      const revision = group.revision;
      const avatarKey = randomUUID();
      group = await store.change(actors[0], group.id, revision, avatarChange, null, avatarKey, fingerprint(avatarChange));
      assert.notEqual(group.revision, revision);
      assert.equal((await store.change(actors[0], group.id, revision, avatarChange, null, avatarKey, fingerprint(avatarChange))).revision, group.revision);
      await assert.rejects(store.change(actors[0], group.id, revision, avatarChange, null, randomUUID(), fingerprint(avatarChange)),
        (error) => error.status === 412);
      if (currency === 'none') {
        for (const avatar of GROUP_AVATARS) await change({ type: 'set-avatar', avatar: avatar.id });
      }
      await change({ type: 'set-visibility', isPublic: true });
      const discovered = (await reader.search(actors[1], name, null)).groups.find((entry) => entry.id === group.id);
      assert.equal(discovered.avatar, group.avatar);
      const durable = await reader.get(actors[1], group.id);
      assert.equal(durable.currency, currency);
      assert.equal(durable.avatar, group.avatar);
      assert.deepEqual(durable.players, roster);
      assert.deepEqual(durable.games, games);
      assert.deepEqual(getStandings(durable), standings);
      const summary = (await reader.summaries(actors[1])).find((entry) => entry.id === group.id);
      assert.deepEqual(summary, summarizeGroup(durable));
      assert.equal(summary.playerCount, 4);
      assert.equal(summary.completedGameCount, 1);
      assert.equal(summary.latestCompletedAt, games[0].completedAt);
      await assert.rejects(pool.request().input('id', sql.UniqueIdentifier, group.id)
        .query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED; UPDATE dbo.Groups SET avatar = 'smile' WHERE id = @id;"),
        (error) => error.number === 547);
      await assert.rejects(pool.request().input('id', sql.UniqueIdentifier, group.id)
        .query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED; UPDATE dbo.Groups SET currency = 'USD' WHERE id = @id;"),
        (error) => error.number === 547);
      const runtime = await pool.request().input('id', sql.UniqueIdentifier, group.id).query(`
        SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
        EXECUTE AS USER = 'dinknpc_api';
        BEGIN TRY
          UPDATE dbo.Groups SET avatar = 'stadium' WHERE id = @id;
          SELECT currency, avatar FROM dbo.Groups WHERE id = @id;
          REVERT;
        END TRY
        BEGIN CATCH
          REVERT;
          THROW;
        END CATCH;`);
      assert.deepEqual(runtime.recordset[0], { currency, avatar: 'stadium' });
      group = await reader.get(actors[0], group.id);
      assert.deepEqual(group.games, games);
      const firstCompletion = group.games[0].completedAt;
      await change(setup);
      assert.equal((await reader.summaries(actors[0])).find(entry => entry.id === group.id).latestCompletedAt, firstCompletion);
      const nextGameId = group.games[1].id;
      await change({ type: 'record-result', gameId: nextGameId, scoreA: '11', scoreB: '6' });
      assert.equal((await reader.summaries(actors[1])).find(entry => entry.id === group.id).latestCompletedAt, group.games[1].completedAt);
      await change({ type: 'delete-game', gameId: nextGameId });
      assert.equal((await reader.summaries(actors[0])).find(entry => entry.id === group.id).latestCompletedAt, firstCompletion);
      await pool.request().input('group', sql.UniqueIdentifier, group.id).input('game', sql.NVarChar(80), group.games[0].id)
        .query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED; UPDATE dbo.Games SET completed_at = NULL WHERE group_id = @group AND id = @game;');
      const historicalSummary = (await reader.summaries(actors[0])).find(entry => entry.id === group.id);
      assert.equal(historicalSummary.completedGameCount, 1);
      assert.equal(historicalSummary.latestCompletedAt, null);
      await change({ type: 'delete-game', gameId: group.games[0].id });
      assert.equal((await reader.summaries(actors[0])).find((entry) => entry.id === group.id).completedGameCount, 0);
      assert.equal((await reader.summaries(actors[0])).find((entry) => entry.id === group.id).latestCompletedAt, null);
      assert.ok(getStandings(await reader.get(actors[0], group.id)).every((row) => row.rank === null && row.netUnits === 0));
      if (currency === 'money') {
        await change(setup);
        const gameId = group.games[0].id;
        await pool.request().input('group', sql.UniqueIdentifier, group.id).input('game', sql.NVarChar(80), gameId)
          .query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED; UPDATE dbo.Games SET wager_cents = 125 WHERE group_id = @group AND id = @game;');
        group = await reader.get(actors[0], group.id);
        await change({ type: 'record-result', gameId, scoreA: '11', scoreB: '7' });
        assert.equal(group.games[0].wagerUnits, 125);
        assert.deepEqual(getStandings(group).map((row) => row.netUnits), [125, 125, -125, -125]);
      }
    }
  } finally {
    if (otherPool) await otherPool.close();
    try { await cleanupFixtures(pool, groupIds, playerIds); }
    finally { await pool.close(); }
  }
});
