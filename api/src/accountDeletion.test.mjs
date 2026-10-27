import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createAccountAdministrator, processAccountDeletions, requireRecentPassword } from './accountDeletion.ts';
import { ApiError } from './contracts.ts';
import { createApi } from './api.ts';

const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', name: 'Synthetic owner', avatar: 'smile' };
const target = { ...actor, id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002' };
const receiptId = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const group = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', revision: '0000000000000001', canManage: true, isOwner: true };
const token = (claims) => `synthetic.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const recent = () => token({ sub: actor.id, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] });

test('deletion requires a recent password authentication, not a fresh refresh-token timestamp', () => {
  const now = 1800000000000;
  const claims = { sub: actor.id, amr: [{ method: 'password', timestamp: now / 1000 - 300 }] };
  assert.doesNotThrow(() => requireRecentPassword(token(claims), actor.id, now));
  for (const value of [
    'invalid', token({ ...claims, sub: target.id }), token({ sub: actor.id, iat: now / 1000 }),
    token({ sub: actor.id, amr: [{ method: 'recovery', timestamp: now / 1000 }] }),
    token({ sub: actor.id, amr: [{ method: 'password', timestamp: now / 1000 - 301 }] }),
    token({ sub: actor.id, amr: [{ method: 'password', timestamp: now / 1000 + 31 }] }),
    token({ sub: actor.id, amr: [{ method: 'password', timestamp: String(now / 1000) }] }),
  ]) assert.throws(() => requireRecentPassword(value, actor.id, now), (error) => error.status === 401);
});

test('admin deletion is server-only, hard deletes exactly the requested identity, and supports confirmed replay', async () => {
  const calls = [];
  const admin = createAccountAdministrator('https://example.supabase.co', 'sb_secret_synthetic_only', async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? Response.json({ id: actor.id }) : Response.json({ code: 'user_not_found' }, { status: 404 });
  });
  await admin.deleteAccount(actor.id);
  await admin.deleteAccount(actor.id);
  assert.equal(calls[0].url, `https://example.supabase.co/auth/v1/admin/users/${actor.id}`);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].options.body), { should_soft_delete: false });
  assert.equal(calls[0].options.headers.apikey, 'sb_secret_synthetic_only');
  await assert.rejects(admin.deleteAccount('../other'), /player ID/);
  for (const url of ['http://example.test', 'https://example.test/path', 'https://example.test?secret=x']) {
    assert.throws(() => createAccountAdministrator(url, 'sb_secret_synthetic_only'));
  }
  assert.throws(() => createAccountAdministrator('https://example.test', 'sb_publishable_synthetic'));
});

test('generic 404s, wrong acknowledgements, provider failures, and unreadable responses never confirm deletion', async () => {
  for (const response of [
    () => Response.json({ code: 'route_not_found' }, { status: 404 }),
    () => Response.json({ id: target.id }),
    () => Response.json({ error: 'synthetic private details' }, { status: 403 }),
    () => new Response('unreadable', { status: 500 }),
    () => { throw new Error('synthetic sensitive network details'); },
  ]) {
    const admin = createAccountAdministrator('https://example.test', 'sb_secret_synthetic_only', async () => response());
    await assert.rejects(admin.deleteAccount(actor.id), (error) => {
      assert.ok(error instanceof ApiError);
      assert.doesNotMatch(error.message, /sensitive|private|sb_secret/);
      return true;
    });
  }
});

test('durable jobs retry partial failures without exposing account identifiers or credentials in logs', async () => {
  const jobs = [{ id: receiptId, accountId: actor.id }];
  let pending = true;
  const store = {
    pendingDeletions: async () => pending ? jobs : [],
    finishDeletion: mock.fn(async () => { pending = false; }),
    failDeletion: mock.fn(async () => {}),
  };
  const administrator = { deleteAccount: mock.fn(async () => {}) };
  const logs = [];
  administrator.deleteAccount.mock.mockImplementationOnce(async () => { throw new Error('synthetic secret'); });
  await processAccountDeletions(store, administrator, (message) => logs.push(message));
  assert.equal(store.finishDeletion.mock.callCount(), 0);
  assert.equal(store.failDeletion.mock.callCount(), 1);
  store.finishDeletion.mock.mockImplementationOnce(async () => { throw new Error('synthetic persistence failure'); });
  await processAccountDeletions(store, administrator, (message) => logs.push(message));
  assert.equal(pending, true);
  await processAccountDeletions(store, administrator, (message) => logs.push(message));
  assert.equal(pending, false);
  assert.equal(administrator.deleteAccount.mock.callCount(), 3);
  assert.deepEqual(store.finishDeletion.mock.calls.at(-1).arguments, [receiptId, actor.id]);
  assert.ok(logs.every((line) => !line.includes(actor.id) && !line.includes('synthetic secret')));
});

function fixture(enabled = true) {
  const store = {
    syncPlayer: mock.fn(async () => {}),
    get: mock.fn(async () => group),
    ownershipReceipt: mock.fn(async () => null),
    changeOwnership: mock.fn(async (_actor, id, _revision, action) => ({ groupId: id, action: action.type })),
    prepareAccountDeletion: mock.fn(async () => ({ id: receiptId, status: 'pending', retrying: false })),
    deletionStatus: mock.fn(async () => ({ id: receiptId, status: 'completed', retrying: false })),
  };
  const identity = {
    authenticate: mock.fn(async (header) => {
      if (!header) throw new ApiError(401, 'unauthorized', 'Login required.');
      return { player: actor, token: header.slice(7) };
    }),
    findPlayer: mock.fn(async () => target),
  };
  const handler = createApi(store, identity, () => {}, enabled);
  async function request(path, method = 'GET', body, proof = recent(), version = group.revision) {
    const response = await handler(new Request(`https://example.test/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': receiptId,
        ...(proof ? { Authorization: `Bearer ${proof}` } : {}), ...(version ? { 'If-Match': `"${version}"` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, data: await response.json() };
  }
  return { store, identity, request };
}

test('account deletion confirms intent and recent password, always targets the actor, and bypasses normal profile sync', async () => {
  const { store, request } = fixture();
  assert.equal((await request('/me', 'DELETE', { confirmation: 'DELETE' }, null)).status, 401);
  assert.equal((await request('/me', 'DELETE', {})).status, 400);
  assert.equal((await request('/me', 'DELETE', { confirmation: 'DELETE' }, token({ sub: actor.id, iat: Date.now() }))).status, 401);
  assert.equal(store.prepareAccountDeletion.mock.callCount(), 0);
  const result = await request('/me', 'DELETE', { confirmation: 'DELETE', playerId: target.id });
  assert.equal(result.status, 202);
  assert.deepEqual(store.prepareAccountDeletion.mock.calls[0].arguments, [actor, receiptId]);
  assert.equal(store.syncPlayer.mock.callCount(), 0);
  assert.equal((await fixture(false).request('/me', 'DELETE', { confirmation: 'DELETE' })).status, 503);
});

test('owned-group blockers and persistence failures are not reported as accepted deletion', async () => {
  const { store, request } = fixture();
  store.prepareAccountDeletion.mock.mockImplementationOnce(async () => { throw new ApiError(409, 'owned_groups_remaining', 'Resolve owned groups first.'); });
  assert.equal((await request('/me', 'DELETE', { confirmation: 'DELETE' })).status, 409);
  store.prepareAccountDeletion.mock.mockImplementationOnce(async () => { throw new Error('synthetic transaction failure'); });
  assert.equal((await request('/me', 'DELETE', { confirmation: 'DELETE' })).status, 503);
});

test('non-identifying receipt status works after account authentication has been deleted', async () => {
  const { store, identity, request } = fixture();
  const result = await request(`/account-deletions/${receiptId}`, 'GET', undefined, null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { id: receiptId, status: 'completed', retrying: false });
  assert.equal(identity.authenticate.mock.callCount(), 0);
  assert.equal(store.syncPlayer.mock.callCount(), 0);
  assert.equal((await request('/account-deletions/invalid', 'GET', undefined, null)).status, 400);
});

test('ownership changes require current ownership, revision, explicit group deletion, and registered lookup', async () => {
  const { store, identity, request } = fixture();
  const path = `/groups/${group.id}`;
  assert.equal((await request(path, 'DELETE', {})).status, 400);
  assert.equal((await request(`${path}/owner`, 'POST', { playerId: target.id }, recent(), null)).status, 428);
  store.get.mock.mockImplementationOnce(async () => ({ ...group, canManage: false, isOwner: false }));
  assert.equal((await request(`${path}/owner`, 'POST', { playerId: target.id })).status, 403);
  assert.equal(identity.findPlayer.mock.callCount(), 0);
  assert.equal((await request(`${path}/owner`, 'POST', { playerId: target.id })).status, 200);
  assert.equal(identity.findPlayer.mock.callCount(), 1);
  const args = store.changeOwnership.mock.calls[0].arguments;
  assert.equal(args[0], actor);
  assert.equal(args[2], group.revision);
  assert.deepEqual(args[3], { type: 'transfer', playerId: target.id });
  assert.equal(args[4], target);
  assert.equal((await request(path, 'DELETE', { confirmation: 'DELETE' })).status, 200);
});

test('committed ownership/deletion receipts replay before accessing an inaccessible or deleted group', async () => {
  const { store, identity, request } = fixture();
  store.ownershipReceipt.mock.mockImplementation(async () => ({ groupId: group.id, action: 'transfer' }));
  const result = await request(`/groups/${group.id}/owner`, 'POST', { playerId: target.id });
  assert.equal(result.status, 200);
  assert.equal(store.get.mock.callCount(), 0);
  assert.equal(identity.findPlayer.mock.callCount(), 0);
  assert.equal(store.changeOwnership.mock.callCount(), 0);
});
