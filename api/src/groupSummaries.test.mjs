import assert from 'node:assert/strict';
import { test } from 'node:test';
import sql from 'mssql';
import { createSqlStore } from './sqlStore.ts';

const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', name: 'Synthetic owner', avatar: 'smile' };
const row = {
  id: 'BBBBBBBB-BBBB-4BBB-8BBB-000000000001', owner_id: actor.id.toUpperCase(), owner_name: actor.name,
  name: 'Synthetic group', currency: 'none', avatar: 'paddles', revision: Buffer.from('0000000000000001', 'hex'),
  is_public: false, is_admin: false, player_count: '4', completed_count: '2000',
  latest_completed_at: new Date('2026-10-27T16:30:00.000Z'),
};

function fixture(t, { rows = [row], deleting = false, active = true } = {}) {
  const queries = [];
  t.mock.method(sql.Transaction.prototype, 'begin', async () => {});
  t.mock.method(sql.Transaction.prototype, 'commit', async () => {});
  t.mock.method(sql.Transaction.prototype, 'rollback', async () => {});
  t.mock.method(sql.Request.prototype, 'query', async function (query) {
    queries.push(query);
    if (query.includes('FROM dbo.AccountDeletions')) return { recordset: deleting ? [{ id: 'receipt' }] : [] };
    if (query.includes('WITH (UPDLOCK, HOLDLOCK) WHERE id = @actor')) {
      return { recordset: active ? [{ is_guest: false, is_deleted: false }] : [] };
    }
    assert.equal(this.parameters.actor.value, actor.id);
    assert.match(query, /COUNT_BIG\(\*\)/);
    return { recordset: rows };
  });
  return { store: createSqlStore(new sql.ConnectionPool({ server: 'example.test' })), queries };
}

test('SQL summaries use one aggregate query after account guards, not per-group detail reads', async (t) => {
  const { store, queries } = fixture(t, { rows: [row, { ...row, id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', owner_id: 'cccccccc-cccc-4ccc-8ccc-000000000001' }] });
  const summaries = await store.summaries(actor);
  assert.equal(queries.length, 3, 'Two account guard queries plus one summary statement regardless of group count.');
  assert.deepEqual(summaries[0], {
    id: row.id.toLowerCase(), name: row.name, ownerId: actor.id, ownerName: actor.name,
    avatar: 'paddles', currency: 'none', revision: '0000000000000001', isPublic: false,
    canEdit: true, canManage: true, isOwner: true, playerCount: 4, completedGameCount: 2000,
    latestCompletedAt: row.latest_completed_at.toISOString(),
  });
  assert.equal(summaries[1].canManage, false);
  assert.equal(summaries[1].isOwner, false);
  assert.match(queries[2], /g\.owner_id = @actor OR EXISTS/);
  assert.match(queries[2], /member_player\.is_guest = 0 AND member_player\.is_deleted = 0/);
  assert.match(queries[2], /games\.status = 'completed'/);
  assert.match(queries[2], /MAX\(games\.completed_at\) AS latest_completed_at/);
  assert.match(queries[2], /OUTER APPLY/);
  for (const summary of summaries) for (const key of ['players', 'games', 'nextGameNumber', 'adminIds']) assert.equal(key in summary, false);
});

test('SQL summaries preserve unknown historic activity and empty groups without inventing timestamps', async t => {
  const { store } = fixture(t, { rows: [
    { ...row, latest_completed_at: null },
    { ...row, completed_count: '0', latest_completed_at: null },
  ] });
  const summaries = await store.summaries(actor);
  assert.equal(summaries[0].latestCompletedAt, null);
  assert.equal(summaries[0].completedGameCount, 2000);
  assert.equal(summaries[1].latestCompletedAt, null);
  assert.equal(summaries[1].completedGameCount, 0);
});

test('admin summaries retain management access without marking joined groups as owned', async t => {
  const { store } = fixture(t, { rows: [{ ...row, owner_id: 'cccccccc-cccc-4ccc-8ccc-000000000001', is_admin: true }] });
  const [summary] = await store.summaries(actor);
  assert.equal(summary.canManage, true);
  assert.equal(summary.isOwner, false);
});

test('summary queries reject accounts queued for deletion before reading group data', async (t) => {
  const { store, queries } = fixture(t, { deleting: true });
  await assert.rejects(store.summaries(actor), (error) => error.status === 403);
  assert.equal(queries.length, 1);
});

test('summary queries reject missing accounts before reading group data', async (t) => {
  const { store, queries } = fixture(t, { active: false });
  await assert.rejects(store.summaries(actor), (error) => error.status === 403);
  assert.equal(queries.length, 2);
});

test('summary queries return empty membership lists without inventing groups', async (t) => {
  const { store } = fixture(t, { rows: [] });
  assert.deepEqual(await store.summaries(actor), []);
});

test('summary counts reject unsafe totals instead of rounding', async (t) => {
  const { store } = fixture(t, { rows: [{ ...row, completed_count: '9007199254740992' }] });
  await assert.rejects(store.summaries(actor), /Stored integer is invalid/);
});
