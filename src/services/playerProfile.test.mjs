import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AvatarError } from '../domain/avatars.ts';
import { DataError } from './groupsApi.ts';
import { AuthError } from './auth.ts';
import { loadPlayerCode, savePlayerAvatar, savePlayerDisplayName } from './playerProfile.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
test('player code loading requires a confirmed current account, never substitutes a UUID, and permits retry', async () => {
  const player = { id, name: 'Synthetic player', code: 'K7M2Q9' };
  assert.equal(await loadPlayerCode({ syncProfile: async () => player }, id), player.code);
  await assert.rejects(loadPlayerCode(null, id), /configured/);
  for (const invalid of [
    { ...player, id: 'another-account' }, { ...player, isGuest: true }, { ...player, isDeleted: true },
    { ...player, code: undefined }, { ...player, code: 'invalid' }, { ...player, code: id },
  ]) await assert.rejects(loadPlayerCode({ syncProfile: async () => invalid }, id), DataError);
  const error = new DataError('Synthetic temporary outage', 503);
  await assert.rejects(loadPlayerCode({ syncProfile: async () => { throw error; } }, id), cause => cause === error);
  assert.equal(await loadPlayerCode({ syncProfile: async () => player }, id), player.code);
});

function fixture() {
  const calls = [];
  const service = {
    getSessionToken: async () => ({ userId: id, accessToken: 'synthetic' }),
    setAvatar: async (avatar) => { calls.push(['account', avatar]); },
    setDisplayName: async (name) => { calls.push(['account-name', name]); },
  };
  const api = { syncProfile: async () => { calls.push(['sync']); return { id, name: 'Alex', avatar: 'fox' }; } };
  return { calls, service, api };
}

test('avatar saving requires both account storage and a matching server acknowledgement', async () => {
  const { calls, service, api } = fixture();
  assert.deepEqual(await savePlayerAvatar(service, api, id, 'fox'), { id, name: 'Alex', avatar: 'fox' });
  assert.deepEqual(calls, [['account', 'fox'], ['sync']]);
});

test('display-name saves trim input and wait for a matching API acknowledgement', async () => {
  const { calls, service, api } = fixture();
  assert.deepEqual(await savePlayerDisplayName(service, api, id, '  Alex  '), { id, name: 'Alex', avatar: 'fox' });
  assert.deepEqual(calls, [['account-name', 'Alex'], ['sync']]);
});

test('invalid names, missing configuration, and account switches do not save display names', async () => {
  const { calls, service, api } = fixture();
  await assert.rejects(savePlayerDisplayName(service, api, id, ' \t '), AuthError);
  await assert.rejects(savePlayerDisplayName(service, null, id, 'Alex'), DataError);
  await assert.rejects(savePlayerDisplayName(service, api, 'another-account', 'Alex'), error => error.status === 401);
  assert.deepEqual(calls, []);
});

test('name-save failures and stale or ineligible API profiles remain explicit and retryable', async () => {
  const { calls, service, api } = fixture();
  const failure = new AuthError('Synthetic account failure');
  await assert.rejects(savePlayerDisplayName({
    ...service, setDisplayName: async () => { throw failure; },
  }, api, id, 'Alex'), error => error === failure);
  assert.deepEqual(calls, []);
  for (const response of [
    { id, name: 'Old name' }, { id: 'another-account', name: 'Alex' },
    { id, name: 'Alex', isGuest: true }, { id, name: 'Alex', isDeleted: true },
  ]) {
    await assert.rejects(savePlayerDisplayName(service, { syncProfile: async () => response }, id, 'Alex'),
      error => error.status === 502 && /saved to your account.*Press Save player name again/.test(error.message));
  }
  await assert.rejects(savePlayerDisplayName(service, {
    syncProfile: async () => { throw new DataError('Unavailable', 503); },
  }, id, 'Alex'), error => error.status === 503 && /group synchronization was not confirmed/.test(error.message));
  assert.equal((await savePlayerDisplayName(service, api, id, 'Alex')).name, 'Alex');
});

test('invalid input, missing API configuration and account changes do not write profile metadata', async () => {
  const { calls, service, api } = fixture();
  await assert.rejects(savePlayerAvatar(service, api, id, 'bad-avatar'), AvatarError);
  await assert.rejects(savePlayerAvatar(service, null, id, 'fox'), DataError);
  await assert.rejects(savePlayerAvatar(service, api, 'another-account', 'fox'), (error) => error.status === 401);
  assert.deepEqual(calls, []);
});

test('account failures stop synchronization and uncertain synchronization can be retried', async () => {
  const { service, api, calls } = fixture();
  const failure = new Error('synthetic-provider-failure');
  await assert.rejects(savePlayerAvatar({ ...service, setAvatar: async () => { throw failure; } }, api, id, 'fox'), (error) => error === failure);
  assert.deepEqual(calls, []);
  for (const response of [{ id, name: 'Alex' }, { id, name: 'Alex', avatar: 'smile' }, { id: 'another-account', avatar: 'fox' }]) {
    await assert.rejects(savePlayerAvatar(service, { syncProfile: async () => response }, id, 'fox'), /saved to your account.*not confirmed/);
  }
  await assert.rejects(savePlayerAvatar(service, { syncProfile: async () => { throw new DataError('Unavailable', 503); } }, id, 'fox'),
    (error) => error.status === 503 && /Press Save avatar again/.test(error.message));
  assert.equal((await savePlayerAvatar(service, api, id, 'fox')).avatar, 'fox');
});
