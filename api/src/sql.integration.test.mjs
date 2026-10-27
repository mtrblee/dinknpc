import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { createSqlStore } from './sqlStore.ts';
import { getStandings, ValidationError } from '../../src/domain/groups.ts';

const players = ['Synthetic Alex', 'Synthetic Blair', 'Synthetic Casey', 'Synthetic Drew'].map((name, index) => ({
  id: `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, '0')}`, name,
  avatar: ['smile', 'fox', 'panda', 'rocket'][index],
}));
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Azure SQL durably stores groups and games, enforces access, concurrency and idempotency', { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly for the development database test.');
  const pool = await adminConnection();
  const created = [];
  const groupIds = [];
  let secondPool;
  try {
    for (const player of players) {
      const rows = await pool.request().input('id', sql.UniqueIdentifier, player.id)
        .query('SELECT id FROM dbo.Players WHERE id = @id;');
      assert.equal(rows.recordset.length, 0, 'Synthetic IDs already exist; refusing to overwrite data.');
    }
    const store = createSqlStore(pool);
    for (const player of players) { created.push(await store.syncPlayer(player)); }
    assert.equal(new Set(created.map(player => player.code)).size, players.length);
    for (const player of created) {
      assert.match(player.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      assert.equal(await store.resolvePlayerCode(players[0], player.code.toLowerCase()), player.id);
    }
    await assert.rejects(pool.request().input('code', sql.VarChar(6), created[0].code)
      .query('INSERT dbo.PlayerCodes(code, player_id) VALUES (@code, NULL);'), error => error.number === 2627);
    const formatProbe = new sql.Transaction(pool);
    let formatRolledBack = false;
    formatProbe.on('rollback', () => { formatRolledBack = true; });
    await formatProbe.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await assert.rejects(new sql.Request(formatProbe).input('code', sql.VarChar(6), 'ZZZZZ0')
        .query('INSERT dbo.PlayerCodes(code, player_id) VALUES (@code, NULL);'), error => error.number === 547);
    } finally {
      if (!formatRolledBack) await formatProbe.rollback();
    }
    const key = randomUUID();
    let group = await store.create(players[0], 'Durable regression group', key, fingerprint('create'), 'money');
    groupIds.push(group.id);
    const again = await store.create(players[0], 'Durable regression group', key, fingerprint('create'), 'money');
    assert.equal(again.id, group.id);
    await assert.rejects(store.create(players[0], 'Other name', key, fingerprint('other')), (error) => error.status === 409);
    await assert.rejects(store.get(players[1], group.id), (error) => error.status === 404);
    for (const player of players.slice(1)) {
      const command = { type: 'add-player', playerId: player.id };
      group = await store.change(players[0], group.id, group.revision, command, player, randomUUID(), fingerprint(command));
    }
    assert.equal((await store.get(players[1], group.id)).canEdit, true);
    assert.equal((await store.get(players[1], group.id)).canManage, false);
    await assert.rejects(store.change(players[1], group.id, group.revision,
      { type: 'delete-game', gameId: 'missing' }, null, randomUUID(), fingerprint('denied')), (error) => error.status === 403);
    const setup = { type: 'start-game', teamA: players.slice(0, 2).map((p) => p.id), teamB: players.slice(2).map((p) => p.id), wager: '5' };
    group = await store.change(players[0], group.id, group.revision, setup, null, randomUUID(), fingerprint(setup));
    const createdAt = group.games[0].createdAt;
    assert.equal(new Date(createdAt).toISOString(), createdAt);
    assert.equal(group.games[0].completedAt, null);
    const result = { type: 'record-result', gameId: group.games[0].id, scoreA: '11', scoreB: '7' };
    await assert.rejects(store.change(players[0], group.id, group.revision,
      { ...result, scoreB: '11' }, null, randomUUID(), fingerprint('invalid-tie')), ValidationError);
    const unchanged = await store.get(players[0], group.id);
    assert.equal(unchanged.revision, group.revision);
    assert.equal(unchanged.games[0].status, 'pending');
    const resultKey = randomUUID();
    const revision = group.revision;
    group = await store.change(players[0], group.id, revision, result, null, resultKey, fingerprint(result));
    assert.equal(group.games[0].createdAt, createdAt);
    const completedAt = group.games[0].completedAt;
    assert.equal(new Date(completedAt).toISOString(), completedAt);
    assert.ok(completedAt >= createdAt);
    const replay = await store.change(players[0], group.id, revision, result, null, resultKey, fingerprint(result));
    assert.equal(replay.revision, group.revision);
    assert.equal(replay.games[0].completedAt, completedAt);
    await assert.rejects(store.change(players[0], group.id, revision, result, null, randomUUID(), fingerprint(result)),
      (error) => error.status === 412);

    const concurrent = await Promise.allSettled([
      store.change(players[0], group.id, group.revision, setup, null, randomUUID(), fingerprint(setup)),
      store.change(players[0], group.id, group.revision, setup, null, randomUUID(), fingerprint(setup)),
    ]);
    assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((entry) => entry.status === 'rejected').reason.status, 412);
    group = concurrent.find((entry) => entry.status === 'fulfilled').value;

    secondPool = await adminConnection();
    const newActor = { id: randomUUID(), name: 'Synthetic concurrent code', avatar: 'smile' };
    assert.equal((await pool.request().input('id', sql.UniqueIdentifier, newActor.id)
      .query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length, 0);
    created.push(newActor);
    const simultaneous = await Promise.all([store.syncPlayer(newActor), createSqlStore(secondPool).syncPlayer(newActor)]);
    assert.equal(simultaneous[0].code, simultaneous[1].code);
    assert.match(simultaneous[0].code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal((await store.syncPlayer({ ...newActor, name: 'Synthetic renamed account' })).code, simultaneous[0].code);
    const durable = await createSqlStore(secondPool).get(players[1], group.id);
    assert.equal(durable.games.length, 2);
    assert.equal(durable.games[0].status, 'completed');
    assert.deepEqual(durable.games, group.games);
    assert.deepEqual(getStandings(durable).map((row) => row.netUnits), [500, 500, -500, -500]);
    assert.deepEqual(getStandings(durable).map((row) => row.rank), [1, 1, 3, 3]);
    const secondGroup = await store.create(players[0], 'Synthetic avatar second group', randomUUID(), fingerprint('avatar-second-group'));
    groupIds.push(secondGroup.id);
    await store.change(players[0], secondGroup.id, secondGroup.revision,
      { type: 'add-player', playerId: players[1].id }, players[1], randomUUID(), fingerprint('avatar-add'));
    await store.syncPlayer({ ...players[1], name: 'Synthetic updated name', avatar: 'tiger' });
    const updated = await createSqlStore(secondPool).get(players[0], group.id);
    assert.equal(updated.players[1].avatar, 'tiger');
    assert.equal(updated.players[1].name, 'Synthetic updated name', 'Roster reads must use current registered names.');
    assert.deepEqual(updated.games, group.games, 'Changing a profile must not rewrite completed game data.');
    assert.equal(updated.revision, group.revision, 'Cosmetic profiles must not invalidate group mutations.');
    assert.deepEqual(getStandings(updated).map((row) => row.netUnits), [500, 500, -500, -500]);
    const secondRoster = (await createSqlStore(secondPool).get(players[1], secondGroup.id)).players;
    assert.equal(secondRoster.find(player => player.id === players[1].id).avatar, 'tiger');
    assert.equal(secondRoster.find(player => player.id === players[1].id).name, 'Synthetic updated name');
    const snapshots = await pool.request().input('player', sql.UniqueIdentifier, players[1].id)
      .query('SELECT name_snapshot FROM dbo.GroupMembers WHERE player_id = @player;');
    assert.ok(snapshots.recordset.every(row => row.name_snapshot === players[1].name), 'Stored snapshots are retained, not used as account labels.');
    await assert.rejects(pool.request().input('id', sql.UniqueIdentifier, players[1].id)
      .query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; UPDATE dbo.Players SET avatar = 'unknown' WHERE id = @id;"),
      (error) => error.number === 547);
    await store.syncPlayer({ ...players[1], avatar: 'smile' });
    assert.equal((await createSqlStore(secondPool).get(players[1], secondGroup.id)).players.find(player => player.id === players[1].id).avatar, 'smile');
    await pool.request().input('group', sql.UniqueIdentifier, group.id).input('game', sql.NVarChar(80), group.games[0].id)
      .query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; UPDATE dbo.Games SET created_at = NULL, completed_at = NULL WHERE group_id = @group AND id = @game;');
    const historical = (await store.get(players[0], group.id)).games[0];
    assert.equal(historical.createdAt, null);
    assert.equal(historical.completedAt, null);
    assert.equal((await store.change(players[0], group.id, revision, result, null, resultKey, fingerprint(result))).games[0].completedAt, null);
    const deletion = { type: 'delete-game', gameId: group.games[0].id };
    group = await store.change(players[0], group.id, group.revision, deletion, null, randomUUID(), fingerprint(deletion));
    assert.ok(getStandings(group).every((row) => row.rank === null && row.netUnits === 0));
    assert.equal((await createSqlStore(secondPool).get(players[1], group.id)).games.length, 1);

    const term = `Synthetic ${randomUUID()}%_`;
    let discovery = await store.create(players[0], `${term} private`, randomUUID(), fingerprint('discovery'), 'money');
    groupIds.push(discovery.id);
    assert.equal(discovery.isPublic, false);
    assert.equal((await store.search(players[1], term, null)).groups.length, 0);
    async function changeDiscovery(actor, command, target = null) {
      discovery = await store.change(actor, discovery.id, discovery.revision, command, target, randomUUID(), fingerprint(command));
    }
    await changeDiscovery(players[0], { type: 'set-visibility', isPublic: true });
    const publicResult = (await store.search(players[1], term, null)).groups[0];
    assert.deepEqual(Object.keys(publicResult).sort(), ['avatar', 'id', 'memberCount', 'name', 'ownerName', 'relationship'].sort());
    await assert.rejects(store.get(players[1], discovery.id), (error) => error.status === 404);
    const joinKey = randomUUID();
    const joinHash = fingerprint(['join', discovery.id]);
    assert.equal(await store.requestJoin(players[1], discovery.id, joinKey, joinHash), 'pending');
    assert.equal(await store.requestJoin(players[1], discovery.id, joinKey, joinHash), 'pending');
    assert.deepEqual(await store.requests(players[0], discovery.id),
      [{ playerId: players[1].id, displayName: players[1].name, code: created[1].code }]);
    await changeDiscovery(players[0], { type: 'review-request', playerId: players[1].id, decision: 'decline' });
    assert.equal(await store.requestJoin(players[1], discovery.id, joinKey, joinHash), 'declined');
    assert.equal(await store.requestJoin(players[1], discovery.id, randomUUID(), joinHash), 'pending');
    await changeDiscovery(players[0], { type: 'set-visibility', isPublic: false });
    assert.equal((await store.search(players[1], term, null)).groups.length, 0);
    assert.equal((await store.requests(players[0], discovery.id)).length, 1);
    await assert.rejects(store.requestJoin(players[2], discovery.id, randomUUID(), joinHash), (error) => error.status === 404);
    await changeDiscovery(players[0], { type: 'review-request', playerId: players[1].id, decision: 'approve' }, players[1]);
    assert.equal((await store.requests(players[0], discovery.id)).length, 0);
    assert.equal((await store.get(players[1], discovery.id)).canEdit, true);
    await assert.rejects(store.requests(players[1], discovery.id), (error) => error.status === 403);
    await assert.rejects(store.change(players[1], discovery.id, discovery.revision,
      { type: 'set-visibility', isPublic: true }, null, randomUUID(), fingerprint('forbidden-public')), (error) => error.status === 403);
    assert.deepEqual(discovery.players.map(player => player.id), players.slice(0, 2).map(player => player.id));
    for (const player of players.slice(2)) {
      await changeDiscovery(players[1], { type: 'add-player', playerId: player.id }, player);
    }
    await changeDiscovery(players[1], setup);
    await changeDiscovery(players[2], { type: 'record-result', gameId: discovery.games[0].id, scoreA: '11', scoreB: '5' });
    assert.equal(discovery.games[0].status, 'completed');

    for (let index = 0; index < 21; index++) {
      let entry = await store.create(players[0], `${term} ${index}`, randomUUID(), fingerprint(['page', index]));
      groupIds.push(entry.id);
      entry = await store.change(players[0], entry.id, entry.revision, { type: 'set-visibility', isPublic: true },
        null, randomUUID(), fingerprint(['public', index]));
    }
    const firstPage = await store.search(players[1], term, null);
    assert.equal(firstPage.groups.length, 20);
    assert.ok(firstPage.nextCursor);
    const lastPage = await store.search(players[1], term, firstPage.nextCursor);
    assert.equal(lastPage.groups.length, 1);
    assert.equal(lastPage.nextCursor, null);
    assert.equal(new Set([...firstPage.groups, ...lastPage.groups].map((entry) => entry.id)).size, 21);
  } finally {
    if (secondPool) await secondPool.close();
    try { await cleanupFixtures(pool, groupIds, created.map((player) => player.id)); }
    finally { await pool.close(); }
  }
});
