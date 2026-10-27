import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { AuthError } from './auth.ts';
import { createSupabaseAuthService } from './supabaseAuth.ts';

const user = { id: 'synthetic-user-1', email: 'alex@example.test', user_metadata: { display_name: 'Alex' } };
const account = { id: user.id, email: user.email, displayName: 'Alex', avatar: 'smile' };
const session = { user, access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' };

test('deletion reauthentication uses an isolated password session for the same remotely verified account', async () => {
  const primary = { auth: {
    getUser: mock.fn(async () => ({ data: { user }, error: null })),
    signInWithPassword: mock.fn(),
  } };
  const isolated = { auth: { signInWithPassword: mock.fn(async () => ({ data: { user, session }, error: null })) } };
  const factory = mock.fn(() => isolated);
  const service = createSupabaseAuthService(primary, factory);
  await assert.rejects(service.reauthenticate(''), /Enter your password/);
  assert.equal(factory.mock.callCount(), 0);
  assert.deepEqual(await service.reauthenticate(' original password '), { userId: user.id, accessToken: session.access_token });
  assert.deepEqual(isolated.auth.signInWithPassword.mock.calls[0].arguments, [{ email: user.email, password: ' original password ' }]);
  assert.equal(primary.auth.signInWithPassword.mock.callCount(), 0);
  const failure = { code: 'invalid_credentials' };
  isolated.auth.signInWithPassword.mock.mockImplementationOnce(async () => ({ data: {}, error: failure }));
  await assert.rejects(service.reauthenticate('wrong'), (error) => error === failure);
  isolated.auth.signInWithPassword.mock.mockImplementationOnce(async () => ({
    data: { user: { ...user, id: 'someone-else' }, session }, error: null,
  }));
  await assert.rejects(service.reauthenticate('correct'), /could not be confirmed/);
  primary.auth.getUser.mock.mockImplementationOnce(async () => ({ data: {}, error: failure }));
  await assert.rejects(service.reauthenticate('correct'), (error) => error === failure);
});

function fixture() {
  let listener;
  const unsubscribe = mock.fn();
  const auth = {
    getSession: mock.fn(async () => ({ data: { session }, error: null })),
    getUser: mock.fn(async () => ({ data: { user }, error: null })),
    signUp: mock.fn(async () => ({ data: { user, session: null }, error: null })),
    signInWithPassword: mock.fn(async () => ({ data: { user, session }, error: null })),
    verifyOtp: mock.fn(async () => ({ data: { user, session }, error: null })),
    resend: mock.fn(async () => ({ error: null })),
    updateUser: mock.fn(async ({ data }) => ({
      data: { user: { ...user, user_metadata: { ...user.user_metadata, ...data } } }, error: null,
    })),
    signOut: mock.fn(async () => ({ error: null })),
    startAutoRefresh: mock.fn(async () => {}),
    stopAutoRefresh: mock.fn(async () => {}),
    onAuthStateChange: mock.fn((callback) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
  };
  return {
    auth, unsubscribe,
    service: createSupabaseAuthService({ auth }, () => ({ auth })),
    emit: (event, value) => listener(event, value),
  };
}

test('restoration validates cached sessions remotely and returns no tokens to the UI', async () => {
  const { auth, service } = fixture();
  auth.getUser.mock.mockImplementation(async () => ({
    data: { user: { ...user, email: 'updated@example.test' } }, error: null,
  }));
  assert.deepEqual(await service.getCurrentUser(), { ...account, email: 'updated@example.test' });
  assert.equal(auth.getSession.mock.callCount(), 1);
  assert.equal(auth.getUser.mock.callCount(), 1);

  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: null }));
  assert.equal(await service.getCurrentUser(), null);
  assert.equal(auth.getUser.mock.callCount(), 1);
});

test('API credentials include the current account identity and reject a missing session', async () => {
  const { auth, service } = fixture();
  assert.deepEqual(await service.getSessionToken(), { userId: user.id, accessToken: session.access_token });
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: null }));
  await assert.rejects(service.getSessionToken(), /log in again/);
});

test('restoration never treats storage, session, or remote validation failures as authenticated', async () => {
  const failure = new Error('synthetic restore failure');
  for (const method of ['getSession', 'getUser']) {
    const { auth, service } = fixture();
    auth[method].mock.mockImplementation(async () => ({ data: {}, error: failure }));
    await assert.rejects(service.getCurrentUser(), (error) => error === failure);
  }
  const { auth, service } = fixture();
  auth.getSession.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.getCurrentUser(), (error) => error === failure);
});

test('signup submits trimmed email and unchanged password, then requires confirmation', async () => {
  const { auth, service } = fixture();
  assert.equal(await service.signUp(' alex@example.test ', '  passphrase  '), 'confirmation-required');
  assert.deepEqual(auth.signUp.mock.calls[0].arguments, [{
    email: 'alex@example.test', password: '  passphrase  ',
  }]);
  auth.signUp.mock.mockImplementation(async () => ({ data: { user, session }, error: null }));
  assert.equal(await service.signUp(user.email, 'synthetic passphrase'), 'signed-in');
});

test('login uses password auth and verification uses email OTP, preserving leading zeroes', async () => {
  const { auth, service } = fixture();
  await service.signIn(' alex@example.test ', ' legacy ');
  assert.deepEqual(auth.signInWithPassword.mock.calls[0].arguments, [{
    email: user.email, password: ' legacy ',
  }]);
  await service.confirmEmail(' alex@example.test ', ' 001234 ');
  assert.deepEqual(auth.verifyOtp.mock.calls[0].arguments, [{
    email: user.email, token: '001234', type: 'email',
  }]);
  await service.resendConfirmation(' alex@example.test ');
  assert.deepEqual(auth.resend.mock.calls[0].arguments, [{ email: user.email, type: 'signup' }]);
});

test('invalid input never reaches Supabase', async () => {
  const { auth, service } = fixture();
  await assert.rejects(service.signUp(user.email, 'short'), AuthError);
  await assert.rejects(service.signIn('invalid', 'password'), AuthError);
  await assert.rejects(service.signIn(user.email, ''), AuthError);
  await assert.rejects(service.confirmEmail(user.email, 'bad-code'), AuthError);
  await assert.rejects(service.resendConfirmation(''), AuthError);
  for (const method of ['signUp', 'signInWithPassword', 'verifyOtp', 'resend']) {
    assert.equal(auth[method].mock.callCount(), 0);
  }
});

test('provider failures propagate for every account operation instead of returning success', async () => {
  const operations = [
    ['signUp', (service) => service.signUp(user.email, 'synthetic passphrase')],
    ['signInWithPassword', (service) => service.signIn(user.email, 'synthetic passphrase')],
    ['verifyOtp', (service) => service.confirmEmail(user.email, '001234')],
    ['resend', (service) => service.resendConfirmation(user.email)],
    ['updateUser', (service) => service.setDisplayName('Alex')],
    ['updateUser', (service) => service.setAvatar('fox')],
    ['signOut', (service) => service.signOut()],
  ];
  for (const [method, invoke] of operations) {
    const { auth, service } = fixture();
    const failure = { code: 'synthetic-provider-failure' };
    auth[method].mock.mockImplementation(async () => ({ data: {}, error: failure }));
    await assert.rejects(invoke(service), (error) => error === failure);
  }
});

test('missing user or sessions are explicit errors, not successful authentication', async () => {
  const { auth, service } = fixture();
  auth.getUser.mock.mockImplementation(async () => ({ data: { user: null }, error: null }));
  await assert.rejects(service.getCurrentUser(), AuthError);
  auth.signUp.mock.mockImplementation(async () => ({ data: { user: null, session: null }, error: null }));
  await assert.rejects(service.signUp(user.email, 'synthetic passphrase'), AuthError);
  auth.signInWithPassword.mock.mockImplementation(async () => ({ data: { session: null }, error: null }));
  await assert.rejects(service.signIn(user.email, 'synthetic passphrase'), AuthError);
  auth.verifyOtp.mock.mockImplementation(async () => ({ data: { session: null }, error: null }));
  await assert.rejects(service.confirmEmail(user.email, '001234'), AuthError);
});

test('sign-out affects this device session, not every device', async () => {
  const { auth, service } = fixture();
  await service.signOut();
  assert.deepEqual(auth.signOut.mock.calls[0].arguments, [{ scope: 'local' }]);
});

test('subscriptions skip unvalidated startup data, propagate account changes, and unsubscribe', () => {
  const { service, emit, unsubscribe } = fixture();
  const changes = [];
  const stop = service.subscribe((value) => changes.push(value));
  emit('INITIAL_SESSION', session);
  assert.deepEqual(changes, []);
  emit('SIGNED_IN', session);
  emit('TOKEN_REFRESHED', session);
  emit('SIGNED_IN', { ...session, user: { id: 'synthetic-user-2', email: 'blair@example.test' } });
  emit('SIGNED_OUT', null);
  assert.deepEqual(changes, [
    account, account, { id: 'synthetic-user-2', email: 'blair@example.test', displayName: null, avatar: 'smile' }, null,
  ]);
  stop();
  assert.equal(unsubscribe.mock.callCount(), 1);
});

test('display name is saved only to the current user metadata and invalid input never reaches Supabase', async () => {
  const { auth, service } = fixture();
  await service.setDisplayName('  Alex  ');
  assert.deepEqual(auth.updateUser.mock.calls[0].arguments, [{ data: { display_name: 'Alex' } }]);
  await assert.rejects(service.setDisplayName(' '), AuthError);
  assert.equal(auth.updateUser.mock.callCount(), 1);
  auth.updateUser.mock.mockImplementation(async () => ({ data: { user: null }, error: null }));
  await assert.rejects(service.setDisplayName('Alex'), AuthError);
  auth.updateUser.mock.mockImplementation(async () => ({ data: { user }, error: null }));
  await assert.rejects(service.setDisplayName('Blair'), /not saved/);
});

test('accounts without valid display names require onboarding, and profile events carry only public identity', async () => {
  const { auth, service, emit } = fixture();
  for (const value of [undefined, null, 42, {}, '', ' \t ']) {
    auth.getUser.mock.mockImplementation(async () => ({
      data: { user: { ...user, user_metadata: { display_name: value } } }, error: null,
    }));
    assert.equal((await service.getCurrentUser()).displayName, null);
  }
  const changes = [];
  service.subscribe((value) => changes.push(value));
  emit('USER_UPDATED', { ...session, user: { ...user, user_metadata: { display_name: ' Blair ' } } });
  assert.deepEqual(changes, [{ ...account, displayName: 'Blair' }]);
});

test('foreground lifecycle starts and stops refresh and propagates lifecycle failures', async () => {
  const { auth, service } = fixture();
  await service.setActive(true);
  await service.setActive(false);
  assert.equal(auth.startAutoRefresh.mock.callCount(), 1);
  assert.equal(auth.stopAutoRefresh.mock.callCount(), 1);
  const failure = new Error('synthetic refresh failure');
  auth.startAutoRefresh.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.setActive(true), (error) => error === failure);
});

test('avatar updates write only the current account avatar and require a matching acknowledgement', async () => {
  const { auth, service, emit } = fixture();
  await service.setAvatar('fox');
  assert.deepEqual(auth.updateUser.mock.calls[0].arguments, [{ data: { avatar: 'fox' } }]);
  await assert.rejects(service.setAvatar('not-in-picker'), /Choose an avatar/);
  assert.equal(auth.updateUser.mock.callCount(), 1);
  auth.updateUser.mock.mockImplementation(async () => ({ data: { user }, error: null }));
  await assert.rejects(service.setAvatar('fox'), /not saved/);
  await assert.rejects(service.setAvatar('smile'), /not saved/);
  auth.updateUser.mock.mockImplementation(async () => ({ data: { user: null }, error: null }));
  await assert.rejects(service.setAvatar('fox'), /not saved/);
  const changes = [];
  service.subscribe((value) => changes.push(value));
  emit('USER_UPDATED', { ...session, user: { ...user, user_metadata: { ...user.user_metadata, avatar: 'tiger' } } });
  assert.deepEqual(changes, [{ ...account, avatar: 'tiger' }]);
});
