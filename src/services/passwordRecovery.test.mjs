import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { AuthError } from './auth.ts';
import { createPasswordRecovery } from './passwordRecovery.ts';
import { createSupabaseAuthService } from './supabaseAuth.ts';

const email = 'alex@example.test';
const user = { id: 'synthetic-recovery-user', email };
const password = '  synthetic new passphrase  ';
function fixture() {
  const clients = [];
  const createClient = mock.fn(() => {
    const auth = {
      resetPasswordForEmail: mock.fn(async () => ({ data: {}, error: null })),
      verifyOtp: mock.fn(async () => ({ data: { user, session: { user } }, error: null })),
      updateUser: mock.fn(async () => ({ data: { user }, error: null })),
      signOut: mock.fn(async () => ({ error: null })),
    };
    clients.push(auth);
    return { auth };
  });
  return { service: createPasswordRecovery(createClient), clients, createClient };
}

test('recovery requests and verifies codes on a separate client without authenticating the workspace', async () => {
  const { createClient, clients } = fixture();
  const primaryCalls = [];
  const main = { auth: new Proxy({}, { get: (_, property) => { primaryCalls.push(property); throw new Error('Primary client used'); } }) };
  const account = createSupabaseAuthService(main, createClient);
  const service = account.recovery;
  await account.recovery.request(` ${email} `);
  await account.recovery.verify(email, ' 001234 ');
  await account.recovery.setPassword(password, password);
  await account.recovery.finish();
  assert.deepEqual(primaryCalls, []);
  assert.equal(clients.length, 1);
  assert.deepEqual(clients[0].resetPasswordForEmail.mock.calls[0].arguments, [email]);
  assert.deepEqual(clients[0].verifyOtp.mock.calls[0].arguments, [{ email, token: '001234', type: 'recovery' }]);
  assert.deepEqual(clients[0].updateUser.mock.calls[0].arguments, [{ password }]);
  assert.deepEqual(clients[0].signOut.mock.calls[0].arguments, [{ scope: 'global' }]);
  await assert.rejects(service.setPassword(password, password), /Verify/);
  await assert.rejects(service.finish(), /Set a new password/);
});

test('a code can be entered after app restart without requesting another email', async () => {
  const { service, clients } = fixture();
  await service.verify(email, '0123456789');
  await service.setPassword(password, password);
  assert.equal(clients[0].resetPasswordForEmail.mock.callCount(), 0);
});

test('invalid input never requests email, verifies a code, or changes a password', async () => {
  const { service, clients, createClient } = fixture();
  await assert.rejects(service.request('invalid'), AuthError);
  await assert.rejects(service.verify(email, '12abc4'), AuthError);
  assert.equal(createClient.mock.callCount(), 0);
  await assert.rejects(service.setPassword(password, password), /Verify/);
  await service.verify(email, '001234');
  await assert.rejects(service.setPassword('short', 'short'), /at least 12/);
  await assert.rejects(service.setPassword(password, password.trim()), /do not match/);
  assert.equal(clients[0].updateUser.mock.callCount(), 0);
});

test('expired or incorrect codes do not permit a password update and can be retried', async () => {
  const { service, clients } = fixture();
  await service.request(email);
  const failure = { code: 'otp_expired' };
  clients[0].verifyOtp.mock.mockImplementationOnce(async () => ({ data: {}, error: failure }));
  await assert.rejects(service.verify(email, '001234'), (error) => error === failure);
  await assert.rejects(service.setPassword(password, password), /Verify/);
  await service.verify(email, '001235');
  await service.setPassword(password, password);
  assert.equal(clients[0].updateUser.mock.callCount(), 1);
});

test('missing or mismatched recovery identities never authorize a password change', async () => {
  for (const data of [
    { user: null, session: null },
    { user, session: null },
    { user: null, session: { user } },
    { user, session: { user: { ...user, id: 'different-synthetic-user' } } },
    { user: { ...user, email: 'someone-else@example.test' }, session: { user } },
  ]) {
    const { service, clients } = fixture();
    await service.request(email);
    clients[0].verifyOtp.mock.mockImplementation(async () => ({ data, error: null }));
    await assert.rejects(service.verify(email, '001234'), /could not be verified/);
    await assert.rejects(service.setPassword(password, password), /Verify/);
    assert.equal(clients[0].updateUser.mock.callCount(), 0);
  }
});

test('cancellation or a fresh request discards the previous verified session', async () => {
  const { service, clients } = fixture();
  await service.verify(email, '001234');
  service.cancel();
  await assert.rejects(service.setPassword(password, password), /Verify/);
  await service.verify(email, '001235');
  await service.request(email);
  await assert.rejects(service.setPassword(password, password), /Verify/);
  assert.equal(clients.length, 3);
  assert.ok(clients.every((auth) => auth.updateUser.mock.callCount() === 0));
});

test('a failed final sign-out is retried independently without resubmitting the new password', async () => {
  const { service, clients } = fixture();
  await service.verify(email, '001234');
  await service.setPassword(password, password);
  const failure = new Error('synthetic offline failure');
  clients[0].signOut.mock.mockImplementationOnce(async () => ({ error: failure }));
  await assert.rejects(service.finish(), (error) => error === failure);
  assert.throws(() => service.cancel(), /password was updated/);
  await assert.rejects(service.request(email), /password was updated/);
  await assert.rejects(service.setPassword(password, password), /Verify/);
  await service.finish();
  assert.equal(clients[0].signOut.mock.callCount(), 2);
  assert.equal(clients[0].updateUser.mock.callCount(), 1);
});

test('provider failures and unacknowledged password writes remain explicit', async () => {
  const { service, clients } = fixture();
  await service.request(email);
  const failure = { code: 'weak_password' };
  await service.verify(email, '001234');
  clients[0].updateUser.mock.mockImplementationOnce(async () => ({ data: {}, error: failure }));
  await assert.rejects(service.setPassword(password, password), (error) => error === failure);
  await assert.rejects(service.finish(), /Set a new password/);
  clients[0].updateUser.mock.mockImplementationOnce(async () => ({ data: { user: null }, error: null }));
  await assert.rejects(service.setPassword(password, password), /could not be confirmed/);
  clients[0].updateUser.mock.mockImplementationOnce(async () => ({ data: { user: { ...user, id: 'different-user' } }, error: null }));
  await assert.rejects(service.setPassword(password, password), /could not be confirmed/);
  await service.setPassword(password, password);
  await service.finish();
});

test('email delivery failures propagate without claiming successful delivery', async () => {
  const { service, clients, createClient } = fixture();
  const failure = { code: 'over_email_send_rate_limit' };
  createClient.mock.mockImplementationOnce(() => ({ auth: {
    resetPasswordForEmail: async () => ({ error: failure }),
  } }));
  await assert.rejects(service.request(email), (error) => error === failure);
  assert.equal(clients.length, 0);
  await assert.rejects(service.setPassword(password, password), /Verify/);
});

test('overlapping recovery operations and cancellation during a write are rejected', async () => {
  const { service, clients } = fixture();
  await service.verify(email, '001234');
  let resolve;
  clients[0].updateUser.mock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const writing = service.setPassword(password, password);
  assert.throws(() => service.cancel(), /Wait/);
  await assert.rejects(service.request(email), /Wait/);
  await assert.rejects(service.verify(email, '001234'), /Wait/);
  await assert.rejects(service.setPassword(password, password), /Wait/);
  resolve({ data: { user }, error: null });
  await writing;
  await service.finish();
});
