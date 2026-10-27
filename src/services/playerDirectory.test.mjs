import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ValidationError } from '../domain/groups.ts';
import { createPlayerDirectory, PlayerLookupError } from './playerDirectory.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const otherId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

function fixture(data = [{ id, display_name: 'Alex' }], error = null) {
  const rpc = mock.fn(async () => ({ data, error }));
  return { rpc, directory: createPlayerDirectory({ rpc }) };
}

test('player lookup uses an exact normalized ID and returns only ID, display name and avatar', async () => {
  const { rpc, directory } = fixture([{ id, display_name: ' Alex ', avatar: 'fox', email: 'not-returned@example.test' }]);
  assert.deepEqual(await directory.findPlayer(` ${id.toUpperCase()} `), { id, name: 'Alex', avatar: 'fox' });
  assert.deepEqual(rpc.mock.calls[0].arguments, ['find_registered_player', { p_player_id: id }]);
  assert.equal((await fixture().directory.findPlayer(id)).avatar, 'smile');
});

test('invalid IDs never call the backend', async () => {
  const { rpc, directory } = fixture();
  for (const value of ['', 'Alex', 'alex@example.test', `${id} trailing text`]) {
    await assert.rejects(directory.findPlayer(value), ValidationError);
  }
  assert.equal(rpc.mock.callCount(), 0);
});

test('missing, unverified, and incomplete accounts use the same ineligible-player response', async () => {
  const { directory } = fixture([]);
  await assert.rejects(directory.findPlayer(id), /No eligible player/);
});

test('malformed or mismatched lookup data cannot create a player', async () => {
  for (const data of [
    null, {}, [null], [{}], [{ id: otherId, display_name: 'Alex' }],
    [{ id, display_name: 5 }], [{ id, display_name: ' ' }],
    [{ id, display_name: 'Alex' }, { id: otherId, display_name: 'Alex' }],
  ]) {
    await assert.rejects(fixture(data).directory.findPlayer(id), PlayerLookupError);
  }
});

test('lookup failures are explicit, including missing SQL setup and caller authorization', async () => {
  for (const [code, message] of [
    ['PGRST202', /not configured/], ['42501', /verified email/], ['unknown', /lookup failed/],
  ]) {
    await assert.rejects(fixture(null, { code }).directory.findPlayer(id), message);
  }
  const { rpc, directory } = fixture();
  rpc.mock.mockImplementation(async () => { throw new Error('synthetic network failure'); });
  await assert.rejects(directory.findPlayer(id), /Check your connection/);
});
