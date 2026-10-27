import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { adminConnection } from '../scripts/adminConnection.mjs';
import { cleanupFixtures } from '../scripts/cleanupFixtures.mjs';
import { createSqlStore } from './sqlStore.ts';
import { getPoolStandings } from '../../src/domain/tournaments.ts';

const actors = Array.from({ length: 5 }, (_, i) => ({
  id: `eeeeeeee-eeee-4eee-8eee-${String(901 + i).padStart(12, '0')}`, name: `Synthetic role player ${i + 1}`, avatar: 'smile',
}));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Azure SQL persists creator enrollment and admin roles, while ownership and revocation remain authoritative', { timeout: 240000 }, async () => {
  if (process.env.RUN_SQL_INTEGRATION !== '1') throw new Error('Set RUN_SQL_INTEGRATION=1 explicitly.');
  const pool = await adminConnection(), created = [], groups = [];
  let second;
  try {
    const store = createSqlStore(pool);
    for (const actor of actors) {
      assert.equal((await pool.request().input('id', sql.UniqueIdentifier, actor.id).query('SELECT id FROM dbo.Players WHERE id = @id;')).recordset.length, 0);
      await store.syncPlayer(actor); created.push(actor.id);
    }
    const [owner, admin, successor, member, applicant] = actors;
    const name = `Synthetic admin group ${randomUUID()}`, key = randomUUID(), hash = fingerprint(name);
    let group = await store.create(owner, name, key, hash);
    groups.push(group.id);
    assert.deepEqual(group.players, [await store.syncPlayer(owner)]);
    assert.equal(group.isOwner, true);
    assert.deepEqual(group.adminIds, []);
    assert.equal((await store.create(owner, name, key, hash)).players.length, 1);
    async function change(actor, command, target = null) {
      group = await store.change(actor, group.id, group.revision, command, target, randomUUID(), fingerprint(command));
      return group;
    }
    for (const actor of [admin, successor, member]) await change(owner, { type: 'add-player', playerId: actor.id }, actor);
    await change(owner, { type: 'set-admin', playerId: admin.id, isAdmin: true }, admin);
    const beforeRace = group.revision;
    const grants = [
      { actor: admin, target: successor }, { actor: owner, target: member },
    ];
    const raced = await Promise.allSettled(grants.map(({ actor, target }) => {
      const action = { type: 'set-admin', playerId: target.id, isAdmin: true };
      return store.change(actor, group.id, beforeRace, action, target, randomUUID(), fingerprint(action));
    }));
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(raced.find(result => result.status === 'rejected').reason.status, 412);
    group = await store.get(owner, group.id);
    await change(owner, { type: 'set-admin', playerId: successor.id, isAdmin: true }, successor);
    second = await adminConnection();
    const reader = createSqlStore(second);
    assert.deepEqual((await reader.get(admin, group.id)).adminIds, group.adminIds);
    const summary = (await reader.summaries(admin)).find(item => item.id === group.id);
    assert.equal(summary.canManage, true);
    assert.equal(summary.isOwner, false);
    await change(admin, { type: 'set-avatar', avatar: 'trophy' });
    await change(admin, { type: 'set-visibility', isPublic: true });
    await store.requestJoin(applicant, group.id, randomUUID(), fingerprint('join'));
    group = await store.get(admin, group.id);
    assert.ok((await store.requests(admin, group.id)).some(request => request.playerId === applicant.id));
    await change(admin, { type: 'review-request', playerId: applicant.id, decision: 'approve' }, applicant);
    await change(admin, { type: 'set-admin', playerId: applicant.id, isAdmin: true }, applicant);
    await change(admin, { type: 'remove-player', playerId: applicant.id });
    assert.ok(!group.adminIds.includes(applicant.id));
    await assert.rejects(reader.get(applicant, group.id), error => error.status === 404);
    const create = { type: 'create', name: 'Admin tournament', teams: [actors.slice(0, 2).map(p => p.id), actors.slice(2, 4).map(p => p.id)] };
    let state = await store.changeTournament(admin, group.id, null, create, randomUUID(), fingerprint(create));
    group = state.group;
    const id = state.selectedId;
    let tournament = state.tournaments.find(t => t.id === id);
    async function tournamentAction(action) {
      state = await store.changeTournament(admin, group.id, group.revision, action, randomUUID(), fingerprint(action));
      group = state.group; tournament = state.tournaments.find(t => t.id === id);
    }
    await tournamentAction({ type: 'score', id, matchId: tournament.pool[0].id, scoreA: '11', scoreB: '7' });
    await tournamentAction({ type: 'start-playoffs', id, seeds: getPoolStandings(group, tournament).map(row => row.teamId) });
    await tournamentAction({ type: 'reset-playoffs', id });
    for (const action of [{ type: 'delete' }, { type: 'transfer', playerId: successor.id }]) {
      await assert.rejects(store.changeOwnership(admin, group.id, group.revision, action, successor, randomUUID(), fingerprint(action)), error => error.status === 403);
    }
    const previous = group;
    await store.changeOwnership(owner, group.id, group.revision, { type: 'transfer', playerId: successor.id },
      successor, randomUUID(), fingerprint('transfer'));
    group = await reader.get(successor, group.id);
    assert.equal(group.isOwner, true);
    assert.ok(!group.adminIds.includes(successor.id));
    assert.deepEqual(group.players, previous.players);
    assert.deepEqual(group.games, previous.games);
    const former = await reader.get(owner, group.id);
    assert.equal(former.isOwner, false);
    assert.equal(former.canManage, false);
    assert.ok(group.adminIds.includes(admin.id));
    await change(successor, { type: 'set-admin', playerId: admin.id, isAdmin: false });
    await assert.rejects(store.requests(admin, group.id), error => error.status === 403);
    await assert.rejects(store.changeTournament(admin, group.id, null, create, randomUUID(), fingerprint('revoked')), error => error.status === 403);
    assert.equal((await reader.get(admin, group.id)).canManage, false);
    assert.equal((await store.create(owner, name, key, hash)).isOwner, false);
  } finally {
    if (second) await second.close();
    try { await cleanupFixtures(pool, groups, created); }
    finally { await pool.close(); }
  }
});
