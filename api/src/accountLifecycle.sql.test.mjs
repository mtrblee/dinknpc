import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { createSqlStore } from './sqlStore.ts';
import { processAccountDeletions } from './accountDeletion.ts';
import { getStandings } from '../../src/domain/groups.ts';
import { getPoolStandings, tournamentPhase } from '../../src/domain/tournaments.ts';

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('ownership, erasure, anonymous history, pending tournament continuation, races, and durable deletion receipts', { timeout: 300000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Explicit development database approval and RUN_SQL_INTEGRATION=1 are required.');
  const pool = await adminConnection();
  const actors = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), name: `Synthetic lifecycle participant ${index}`, avatar: 'fox' }));
  const groups = [];
  const players = [];
  const codes = [];
  const creations = new Map();
  let second;
  try {
    const store = createSqlStore(pool);
    for (const actor of actors) {
      assert.equal((await pool.request().input('id', sql.UniqueIdentifier, actor.id).query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length, 0);
      const profile = await store.syncPlayer(actor);
      assert.match(profile.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      codes.push(profile.code);
      players.push(actor.id);
    }
    second = await adminConnection();
    const other = createSqlStore(second);
    const [departing, owner, third] = actors;
    assert.equal(await store.resolvePlayerCode(owner, codes[0].toLowerCase()), departing.id);
    async function create(actor) {
      const name = `Synthetic lifecycle ${randomUUID()}`;
      const key = randomUUID();
      const hash = fingerprint(randomUUID());
      const group = await store.create(actor, name, key, hash, 'money');
      groups.push(group.id);
      creations.set(group.id, { name, key, hash });
      return group;
    }
    async function change(actor, group, command, target = null) {
      return store.change(actor, group.id, group.revision, command, target, randomUUID(), fingerprint(command));
    }
    async function populate(actor, group, roster = actors) {
      for (const player of roster) {
        if (!group.players.some(member => member.id === player.id)) group = await change(actor, group, { type: 'add-player', playerId: player.id }, player);
      }
      return group;
    }
    let owned = await populate(departing, await create(departing), [owner]);
    owned = await change(departing, owned, { type: 'remove-player', playerId: departing.id });
    const beforeBlocked = await store.list(departing);
    await assert.rejects(store.prepareAccountDeletion(departing, randomUUID()), (error) => error.code === 'owned_groups_remaining');
    assert.deepEqual(await store.list(departing), beforeBlocked);
    const transfer = { type: 'transfer', playerId: owner.id };
    const transferKey = randomUUID();
    const transferHash = fingerprint([owned.id, owned.revision, transfer]);
    for (const candidate of [departing, actors[3], { ...owner, isGuest: true }, { ...owner, isDeleted: true }]) {
      const invalid = { type: 'transfer', playerId: candidate.id };
      await assert.rejects(store.changeOwnership(departing, owned.id, owned.revision, invalid, candidate, randomUUID(), fingerprint(invalid)),
        (error) => error.code === 'ineligible_owner');
    }
    const conflict = await store.create(owner, owned.name, randomUUID(), fingerprint('name-conflict'));
    groups.push(conflict.id);
    await assert.rejects(store.changeOwnership(departing, owned.id, owned.revision, transfer, owner, randomUUID(), transferHash), /already exists/);
    await store.changeOwnership(owner, conflict.id, conflict.revision, { type: 'delete' }, null, randomUUID(), fingerprint('remove-conflict'));
    await assert.rejects(store.changeOwnership(owner, owned.id, owned.revision, transfer, owner, randomUUID(), transferHash), (error) => error.status === 403);
    await assert.rejects(store.changeOwnership(departing, owned.id, '0000000000000000', transfer, owner, randomUUID(), transferHash), (error) => error.status === 412);
    assert.deepEqual(await store.changeOwnership(departing, owned.id, owned.revision, transfer, owner, transferKey, transferHash),
      { groupId: owned.id, action: 'transfer' });
    assert.deepEqual(await store.changeOwnership(departing, owned.id, owned.revision, transfer, owner, transferKey, transferHash),
      { groupId: owned.id, action: 'transfer' });
    await assert.rejects(store.get(departing, owned.id), (error) => error.status === 404);
    owned = await store.get(owner, owned.id);
    assert.equal(owned.ownerId, owner.id);
    assert.ok(!owned.players.some((player) => player.id === departing.id), 'Transfer must not add the former owner to the roster.');

    let shared = await populate(owner, await create(owner));
    shared = await change(owner, shared, { type: 'set-admin', playerId: departing.id, isAdmin: true }, departing);
    shared = await change(owner, shared, { type: 'set-admin', playerId: third.id, isAdmin: true }, third);
    let another = await populate(third, await create(third));
    const unused = await populate(third, await create(third), [departing]);
    const setup = { type: 'start-game', teamA: actors.slice(0, 2).map((player) => player.id),
      teamB: actors.slice(2).map((player) => player.id), wager: '2' };
    shared = await change(owner, shared, setup);
    shared = await change(owner, shared, { type: 'record-result', gameId: shared.games[0].id, scoreA: '11', scoreB: '7' });
    another = await change(third, another, setup);
    another = await change(third, another, { type: 'record-result', gameId: another.games[0].id, scoreA: '11', scoreB: '7' });
    const tournamentAction = { type: 'create', name: 'Synthetic deletion cup', teams: [setup.teamA, setup.teamB] };
    let tournamentResult = await store.changeTournament(owner, shared.id, null, tournamentAction, randomUUID(), fingerprint(tournamentAction));
    shared = tournamentResult.group;
    const originalGame = shared.games[0];
    const previousTotals = getStandings(shared).map(({ player, ...row }) => row);
    const receiptKey = randomUUID();
    const racing = await Promise.allSettled([
      store.prepareAccountDeletion(departing, receiptKey),
      other.change(owner, shared.id, shared.revision, setup, null, randomUUID(), fingerprint(['race', setup])),
    ]);
    assert.equal(racing[0].status, 'fulfilled');
    if (racing[1].status === 'rejected') assert.ok([400, 412].includes(racing[1].reason.status) || racing[1].reason.name === 'ValidationError');
    const receipt = racing[0].value;
    assert.deepEqual(receipt, { id: receiptKey, status: 'pending', retrying: false });
    assert.deepEqual(await store.prepareAccountDeletion(departing, randomUUID()), receipt);
    await assert.rejects(store.resolvePlayerCode(owner, codes[0]), error => error.status === 404);
    assert.deepEqual((await pool.request().input('code', sql.VarChar(6), codes[0])
      .query('SELECT player_id FROM dbo.PlayerCodes WHERE code = @code;')).recordset, [{ player_id: null }]);
    for (const operation of [
      () => store.syncPlayer(departing), () => store.list(departing), () => store.get(departing, shared.id),
      () => store.create(departing, 'Blocked', randomUUID(), fingerprint('blocked')),
      () => store.requestJoin(departing, shared.id, randomUUID(), fingerprint('join')),
    ]) await assert.rejects(operation(), (error) => error.code === 'account_deleting');
    assert.deepEqual((await store.get(third, unused.id)).players.map(player => player.id), [third.id]);
    shared = await store.get(owner, shared.id);
    assert.deepEqual(shared.adminIds, [third.id]);
    another = await store.get(third, another.id);
    const anonymous = shared.players.find((player) => player.isDeleted);
    const otherAnonymous = another.players.find((player) => player.isDeleted);
    assert.ok(anonymous && otherAnonymous);
    assert.notEqual(anonymous.id, otherAnonymous.id);
    assert.ok(!JSON.stringify([shared, another]).includes(departing.id));
    assert.ok(!JSON.stringify([shared, another]).includes(departing.name));
    assert.deepEqual(getStandings(shared).map(({ player, ...row }) => row), previousTotals);
    assert.deepEqual(shared.games[0], { ...originalGame, teamA: [anonymous.id, owner.id] });
    await assert.rejects(change(owner, shared, { ...setup, teamA: [anonymous.id, owner.id] }), /Deleted players/);
    await assert.rejects(store.syncPlayer({ ...anonymous, isDeleted: false, name: 'Invalid promotion' }), (error) => error.status === 403);
    await assert.rejects(store.changeOwnership(owner, shared.id, shared.revision, { type: 'transfer', playerId: anonymous.id },
      anonymous, randomUUID(), fingerprint('anonymous-owner')), (error) => error.code === 'ineligible_owner');

    tournamentResult = await store.tournaments(owner, shared.id);
    let tournament = tournamentResult.tournaments[0];
    async function tournamentChange(action) {
      tournamentResult = await store.changeTournament(owner, shared.id, shared.revision, action, randomUUID(), fingerprint(action));
      shared = tournamentResult.group;
      tournament = tournamentResult.tournaments[0];
    }
    await tournamentChange({ type: 'score', id: tournament.id, matchId: tournament.pool[0].id, scoreA: '11', scoreB: '7' });
    await tournamentChange({ type: 'start-playoffs', id: tournament.id, seeds: getPoolStandings(shared, tournament).map((row) => row.teamId) });
    await tournamentChange({ type: 'score', id: tournament.id, matchId: tournament.playoffs[0].id, scoreA: '15', scoreB: '9' });
    assert.equal(tournamentPhase(shared, tournament), 'completed');
    assert.ok(!JSON.stringify(tournamentResult).includes(departing.id));

    const jobs = await store.pendingDeletions();
    assert.ok(jobs.some((job) => job.id === receipt.id && job.accountId === departing.id));
    const scopedStore = { ...store, pendingDeletions: async () => jobs.filter((job) => job.id === receipt.id) };
    await processAccountDeletions(scopedStore, { deleteAccount: async () => { throw new Error('Synthetic provider unavailable'); } }, () => {});
    assert.equal((await store.deletionStatus(receipt.id)).retrying, true);
    await processAccountDeletions(scopedStore, { deleteAccount: async (id) => assert.equal(id, departing.id) }, () => {});
    assert.deepEqual(await store.deletionStatus(receipt.id), { id: receipt.id, status: 'completed', retrying: false });
    const privateJob = (await pool.request().input('id', sql.UniqueIdentifier, receipt.id)
      .query('SELECT account_id FROM dbo.AccountDeletions WHERE id = @id;')).recordset[0];
    assert.equal(privateJob.account_id, null);
    await assert.rejects(store.syncPlayer(departing), (error) => error.code === 'account_deleting');

    another = await change(third, another, { type: 'add-guest', name: 'Synthetic local visitor' });
    const guest = another.players.find((player) => player.isGuest);
    const removalKey = randomUUID();
    const removalHash = fingerprint(['delete', another.id, another.revision]);
    const removal = await store.changeOwnership(third, another.id, another.revision, { type: 'delete' }, null, removalKey, removalHash);
    assert.deepEqual(await store.changeOwnership(third, another.id, another.revision, { type: 'delete' }, null, removalKey, removalHash), removal);
    await assert.rejects(store.get(third, another.id), (error) => error.status === 404);
    const originalCreation = creations.get(another.id);
    await assert.rejects(store.create(third, originalCreation.name, originalCreation.key, originalCreation.hash, 'money'),
      (error) => error.status === 410 && error.code === 'request_retired');
    const localRows = await pool.request().input('guest', sql.UniqueIdentifier, guest.id).input('anonymous', sql.UniqueIdentifier, otherAnonymous.id)
      .query('SELECT id FROM dbo.Players WHERE id IN (@guest, @anonymous);');
    assert.equal(localRows.recordset.length, 0);
    assert.ok((await store.list(third)).some((group) => group.id === unused.id));
    const permissions = await pool.request().query(`
      EXECUTE AS USER = 'dinknpc_api';
      BEGIN TRY
        SELECT HAS_PERMS_BY_NAME('dbo.AccountDeletions', 'OBJECT', 'UPDATE') AS worker_write,
          HAS_PERMS_BY_NAME('dbo.AccountDeletions', 'OBJECT', 'DELETE') AS erase_block,
          HAS_PERMS_BY_NAME('dbo.Groups', 'OBJECT', 'DELETE') AS group_delete;
        REVERT;
      END TRY
      BEGIN CATCH
        REVERT;
        THROW;
      END CATCH;`);
    assert.deepEqual(permissions.recordset[0], { worker_write: 1, erase_block: 0, group_delete: 1 });
  } finally {
    if (second) await second.close();
    try { await cleanupFixtures(pool, groups, players, codes); }
    finally { await pool.close(); }
  }
});
