import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { normalizeGuestNames } from '../scripts/guestNames.mjs';
import { createSqlStore } from './sqlStore.ts';
import { getPlayerLabel, getStandings, ValidationError } from '../../src/domain/groups.ts';
import { getPoolStandings } from '../../src/domain/tournaments.ts';

const actors = Array.from({ length: 3 }, (_, index) => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 501).padStart(12, '0')}`, name: `Synthetic guest-test account ${index + 1}`,
}));
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('SQL guests persist per group, replay safely, never gain account access, and play casual games and tournaments', { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly.');
  const pool = await adminConnection();
  const groupIds = [];
  const createdActors = [];
  let otherPool;
  try {
    for (const actor of actors) {
      const existing = await pool.request().input('id', sql.UniqueIdentifier, actor.id).query('SELECT id FROM dbo.Players WHERE id = @id;');
      assert.equal(existing.recordset.length, 0, 'Refusing to overwrite an existing synthetic ID.');
    }
    const store = createSqlStore(pool);
    for (const actor of actors) { await store.syncPlayer(actor); createdActors.push(actor.id); }
    let group = await store.create(actors[0], `Synthetic guest group ${randomUUID()}`, randomUUID(), fingerprint('group'), 'money');
    groupIds.push(group.id);
    // This fixture exercises a nonplaying owner and a four-player guest/mixed roster.
    group = await store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: actors[0].id },
      null, randomUUID(), fingerprint('nonplaying owner'));
    group = await store.change(actors[0], group.id, group.revision, { type: 'add-player', playerId: actors[1].id },
      actors[1], randomUUID(), fingerprint('member'));
    const command = { type: 'add-guest', name: ' Visitor ' };
    const key = randomUUID();
    const saved = await Promise.all([0, 1].map(() => store.change(actors[0], group.id, null, command, null, key, fingerprint(command))));
    assert.equal(saved[0].revision, saved[1].revision);
    assert.equal(saved[0].players.length, 2);
    group = saved[0];
    const guest = group.players[1];
    assert.deepEqual(guest, { id: guest.id, name: 'Visitor', isGuest: true, avatar: 'smile' });
    assert.equal(getPlayerLabel(group, guest), '(g) Visitor');
    assert.equal(group.canManage, true);
    await assert.rejects(store.change(actors[1], group.id, null, command, null, randomUUID(), fingerprint(command)), (error) => error.status === 403);
    await assert.rejects(store.change(actors[2], group.id, null, command, null, randomUUID(), fingerprint(command)), (error) => error.status === 404);
    await assert.rejects(store.get(guest, group.id), (error) => error.status === 403 && error.code === 'account_required');
    await assert.rejects(store.get({ id: guest.id, name: 'Forged account' }, group.id),
      (error) => error.status === 403 && error.code === 'account_required');
    await assert.rejects(store.syncPlayer(guest), (error) => error.status === 403);
    await assert.rejects(store.syncPlayer({ id: guest.id, name: 'Forged account', avatar: 'fox' }), (error) => error.status === 403);
    await assert.rejects(store.change(actors[0], group.id, null, { type: 'add-guest', name: ' ' }, null, randomUUID(), fingerprint('blank')), ValidationError);
    const simultaneous = await Promise.allSettled(['Guest Two', ' GUEST TWO '].map((name) =>
      store.change(actors[0], group.id, null, { type: 'add-guest', name }, null, randomUUID(), fingerprint(name))));
    assert.equal(simultaneous.filter((result) => result.status === 'fulfilled').length, 1);
    assert.ok(simultaneous.find((result) => result.status === 'rejected').reason instanceof ValidationError);
    group = await store.change(actors[0], group.id, null, { type: 'add-guest', name: 'Guest Three' }, null, randomUUID(), fingerprint('third'));
    const replay = await store.change(actors[0], group.id, null, command, null, key, fingerprint(command));
    assert.equal(replay.players.length, 4);
    assert.equal(replay.players[1].id, guest.id);
    assert.equal(replay.players[1].name, 'Visitor');
    assert.equal(replay.players[1].avatar, 'smile');

    const removedGuest = group.players[2];
    await pool.request().input('group', sql.UniqueIdentifier, group.id).input('guest', sql.UniqueIdentifier, removedGuest.id).query(`
      SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
      BEGIN TRANSACTION;
      BEGIN TRY
        EXECUTE AS USER = 'dinknpc_api';
        UPDATE dbo.GroupMembers SET position = position WHERE group_id = @group;
        DELETE dbo.GroupMembers WHERE group_id = @group AND player_id = @guest;
        DELETE dbo.Players WHERE id = @guest AND is_guest = 1;
        REVERT;
        ROLLBACK;
      END TRY
      BEGIN CATCH
        IF USER_NAME() = 'dinknpc_api' REVERT;
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;`);
    const removal = { type: 'remove-player', playerId: removedGuest.id };
    await assert.rejects(store.change(actors[1], group.id, group.revision, removal, null, randomUUID(), fingerprint(removal)), (error) => error.status === 403);
    await assert.rejects(store.change(actors[0], group.id, '0000000000000000', removal, null, randomUUID(), fingerprint(removal)), (error) => error.status === 412);
    const removalKey = randomUUID();
    const oldRevision = group.revision;
    group = await store.change(actors[0], group.id, oldRevision, removal, null, removalKey, fingerprint(removal));
    assert.equal(group.players.length, 3);
    assert.deepEqual(await store.change(actors[0], group.id, oldRevision, removal, null, removalKey, fingerprint(removal)), group);
    assert.equal((await pool.request().input('id', sql.UniqueIdentifier, removedGuest.id).query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length, 0);
    group = await store.change(actors[0], group.id, null, { type: 'add-guest', name: removedGuest.name }, null, randomUUID(), fingerprint('reuse name'));
    assert.equal(group.players.length, 4);
    assert.notEqual(group.players.at(-1).id, removedGuest.id);
    assert.deepEqual(await store.change(actors[0], group.id, oldRevision, removal, null, removalKey, fingerprint(removal)), group);
    const positions = await pool.request().input('group', sql.UniqueIdentifier, group.id)
      .query('SELECT position FROM dbo.GroupMembers WHERE group_id = @group ORDER BY position;');
    assert.deepEqual(positions.recordset.map((row) => row.position), [0, 1, 2, 3]);

    let shared = await store.create(actors[1], `Synthetic other membership ${randomUUID()}`, randomUUID(), fingerprint('shared'));
    groupIds.push(shared.id);
    assert.deepEqual(shared.players.map(player => player.id), [actors[1].id]);
    group = await store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: actors[1].id },
      null, randomUUID(), fingerprint('remove registered'));
    await assert.rejects(store.get(actors[1], group.id), (error) => error.status === 404);
    assert.equal((await store.get(actors[1], shared.id)).players[0].id, actors[1].id);
    const account = await pool.request().input('id', sql.UniqueIdentifier, actors[1].id).query('SELECT is_guest FROM dbo.Players WHERE id = @id;');
    assert.deepEqual(account.recordset, [{ is_guest: false }]);
    group = await store.change(actors[0], group.id, group.revision, { type: 'add-player', playerId: actors[1].id },
      actors[1], randomUUID(), fingerprint('readd registered'));
    shared = await store.change(actors[1], shared.id, shared.revision, { type: 'remove-player', playerId: actors[1].id },
      null, randomUUID(), fingerprint('creator leaves roster'));
    assert.equal(shared.players.length, 0);
    assert.equal(shared.canManage, true);

    const ids = group.players.map((player) => player.id);
    group = await store.change(actors[1], group.id, group.revision,
      { type: 'start-game', teamA: ids.slice(0, 2), teamB: ids.slice(2), wager: '5' }, null, randomUUID(), fingerprint('game'));
    await assert.rejects(store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: guest.id },
      null, randomUUID(), fingerprint('pending participant')), /game or tournament/);
    group = await store.change(actors[1], group.id, group.revision,
      { type: 'record-result', gameId: group.games[0].id, scoreA: '11', scoreB: '7' }, null, randomUUID(), fingerprint('score'));
    await assert.rejects(store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: actors[1].id },
      null, randomUUID(), fingerprint('completed participant')), /game or tournament/);
    const rows = getStandings(group);
    assert.equal(rows.filter((row) => row.player.isGuest).length, 3);
    assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3, 3]);
    assert.equal(rows.reduce((sum, row) => sum + row.netUnits, 0), 0);
    assert.ok(rows.every((row) => Math.abs(row.netUnits) === 500));
    otherPool = await adminConnection();
    assert.deepEqual((await createSqlStore(otherPool).get(actors[0], group.id)).players, group.players);
    group = await store.change(actors[0], group.id, group.revision,
      { type: 'delete-game', gameId: group.games[0].id }, null, randomUUID(), fingerprint('delete'));
    assert.ok(getStandings(group).every((row) => row.rank === null && row.netUnits === 0));
    assert.equal(group.players.length, 4);

    let second = await store.create(actors[0], `Synthetic all guest cup ${randomUUID()}`, randomUUID(), fingerprint('second'));
    groupIds.push(second.id);
    second = await store.change(actors[0], second.id, second.revision, { type: 'remove-player', playerId: actors[0].id },
      null, randomUUID(), fingerprint('all guest roster'));
    await assert.rejects(store.change(actors[0], second.id, second.revision, { type: 'add-player', playerId: guest.id },
      guest, randomUUID(), fingerprint('copy guest')), (error) => error.status === 404);
    await assert.rejects(store.change(actors[0], second.id, second.revision, { type: 'add-player', playerId: guest.id },
      { id: guest.id, name: 'Claimed account' }, randomUUID(), fingerprint('promote guest')), (error) => error.status === 403);
    for (const name of ['Visitor', 'Visitor Two', 'Guest Three', 'Guest Four']) {
      second = await store.change(actors[0], second.id, null, { type: 'add-guest', name }, null, randomUUID(), fingerprint(name));
    }
    assert.equal(second.players.length, 4);
    assert.ok(second.players.every((player) => player.isGuest && player.id !== guest.id));
    assert.equal(getPlayerLabel(second, second.players[0]), '(g) Visitor');
    const otherIds = second.players.map((player) => player.id);
    await assert.rejects(store.change(actors[0], second.id, second.revision,
      { type: 'start-game', teamA: [guest.id, otherIds[0]], teamB: otherIds.slice(1, 3), wager: '0' },
      null, randomUUID(), fingerprint('cross-group game')), ValidationError);
    let snapshot = await store.changeTournament(actors[0], second.id, null,
      { type: 'create', name: 'All guests', teams: [otherIds.slice(0, 2), otherIds.slice(2)] }, randomUUID(), fingerprint('cup'));
    let tournament = snapshot.tournaments[0];
    await assert.rejects(store.change(actors[0], second.id, snapshot.group.revision, { type: 'remove-player', playerId: otherIds[0] },
      null, randomUUID(), fingerprint('pool participant')), /game or tournament/);
    async function act(action) {
      snapshot = await store.changeTournament(actors[0], second.id, snapshot.group.revision, action, randomUUID(), fingerprint(action));
      tournament = snapshot.tournaments[0];
    }
    await act({ type: 'score', id: tournament.id, matchId: tournament.pool[0].id, scoreA: '11', scoreB: '7' });
    await act({ type: 'start-playoffs', id: tournament.id, seeds: getPoolStandings(snapshot.group, tournament).map((row) => row.teamId) });
    await act({ type: 'score', id: tournament.id, matchId: tournament.playoffs[0].id, scoreA: '15', scoreB: '9' });
    assert.ok(tournament.completedAt);
    assert.ok(getStandings(snapshot.group).every((row) => row.player.isGuest && row.wins + row.losses === 2 && row.netUnits === 0));
    const durable = await createSqlStore(otherPool).tournaments(actors[0], second.id);
    assert.deepEqual(durable, { group: snapshot.group, tournaments: snapshot.tournaments });
    await assert.rejects(store.change(actors[0], second.id, snapshot.group.revision, { type: 'remove-player', playerId: otherIds[0] },
      null, randomUUID(), fingerprint('championship participant')), /game or tournament/);
    const repair = new sql.Transaction(pool);
    await repair.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(repair).input('group', sql.UniqueIdentifier, second.id).input('player', sql.UniqueIdentifier, otherIds[1]).query(`
        UPDATE dbo.GroupMembers SET name_snapshot = 'Visitor' WHERE group_id = @group AND player_id = @player;
        UPDATE dbo.Players SET display_name = 'Visitor' WHERE id = @player;`);
      assert.equal(await normalizeGuestNames(repair, second.id), 1);
      assert.equal(await normalizeGuestNames(repair, second.id), 0);
      await repair.commit();
    } catch (error) { await repair.rollback(); throw error; }
    snapshot = await store.tournaments(actors[0], second.id);
    assert.equal(snapshot.group.players[1].name, 'Visitor (2)');
    assert.deepEqual(snapshot.group.players.map((p) => p.id), otherIds);
    assert.deepEqual(snapshot.group.games, durable.group.games);
    assert.deepEqual(snapshot.tournaments, durable.tournaments);
    assert.notEqual(snapshot.group.revision, durable.group.revision);
    await act({ type: 'reset-playoffs', id: tournament.id });
    assert.ok(getStandings(snapshot.group).every((row) => row.wins + row.losses === 1));
    assert.ok(snapshot.group.players.every((player) => player.isGuest));

    for (const tournamentRace of [false, true]) {
      const participant = group.players.find((player) => player.isGuest && player.id !== guest.id);
      const racingIds = group.players.map((player) => player.id);
      const results = await Promise.allSettled([
        store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: participant.id },
          null, randomUUID(), fingerprint(`race remove ${tournamentRace}`)),
        tournamentRace
          ? store.changeTournament(actors[0], group.id, null, { type: 'create', name: 'Synthetic race cup',
            teams: [racingIds.slice(0, 2), racingIds.slice(2)] }, randomUUID(), fingerprint('race cup'))
          : store.change(actors[0], group.id, group.revision, { type: 'start-game',
            teamA: racingIds.slice(0, 2), teamB: racingIds.slice(2), wager: '0' }, null, randomUUID(), fingerprint('race game')),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const failure = results.find((result) => result.status === 'rejected').reason;
      assert.ok(failure.status === 412 || (tournamentRace && failure instanceof ValidationError));
      group = await store.get(actors[0], group.id);
      if (group.players.some((player) => player.id === participant.id)) {
        await assert.rejects(store.change(actors[0], group.id, group.revision, { type: 'remove-player', playerId: participant.id },
          null, randomUUID(), fingerprint('race protected history')), /game or tournament/);
        if (!tournamentRace) group = await store.change(actors[0], group.id, group.revision,
          { type: 'delete-game', gameId: group.games[0].id }, null, randomUUID(), fingerprint('race cleanup game'));
      } else {
        assert.equal(group.games.length, 0);
        assert.equal((await pool.request().input('id', sql.UniqueIdentifier, participant.id)
          .query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length, 0);
        group = await store.change(actors[0], group.id, null, { type: 'add-guest', name: participant.name },
          null, randomUUID(), fingerprint(`race replacement ${tournamentRace}`));
      }
    }
  } finally {
    if (otherPool) await otherPool.close();
    try { await cleanupFixtures(pool, groupIds, createdActors); }
    finally { await pool.close(); }
  }
});
