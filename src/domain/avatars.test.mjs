import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { AVATARS, AvatarError, DEFAULT_AVATAR, avatarFromMetadata, getAvatar, validateAvatar } from './avatars.ts';
import { addPlayer, createGroup } from './groups.ts';

test('the curated avatar catalog has unique IDs and emoji with a smiling default', () => {
  assert.equal(AVATARS.length, 24);
  assert.equal(new Set(AVATARS.map((entry) => entry.id)).size, AVATARS.length);
  assert.equal(new Set(AVATARS.map((entry) => entry.emoji)).size, AVATARS.length);
  assert.equal(getAvatar().emoji, '\u{1F642}');
  for (const avatar of AVATARS) {
    assert.equal(validateAvatar(avatar.id), avatar.id);
    assert.deepEqual(getAvatar(avatar.id), avatar);
    assert.ok(avatar.label.length > 0);
  }
  const migration = readFileSync(new URL('../../api/sql/004_player_avatars.sql', import.meta.url), 'utf8');
  const ids = [...migration.match(/IN \(([\s\S]*?)\)/)[1].matchAll(/''([^']+)''/g)].map((match) => match[1]);
  assert.deepEqual(ids, AVATARS.map((avatar) => avatar.id));
});

test('missing profile choices default, while unsupported editable metadata is logged without its contents', () => {
  assert.equal(avatarFromMetadata(undefined), DEFAULT_AVATAR);
  assert.equal(avatarFromMetadata(null), DEFAULT_AVATAR);
  assert.equal(avatarFromMetadata('fox'), 'fox');
  const log = mock.method(console, 'error', () => {});
  try {
    for (const value of ['private-invalid-value', '', 42, {}, ['fox']]) {
      assert.equal(avatarFromMetadata(value), DEFAULT_AVATAR);
      assert.throws(() => validateAvatar(value), AvatarError);
    }
    assert.equal(log.mock.callCount(), 5);
    assert.doesNotMatch(JSON.stringify(log.mock.calls), /private-invalid-value/);
  } finally { log.mock.restore(); }
  assert.throws(() => validateAvatar(undefined), AvatarError);
});

test('group additions preserve the verified avatar and never accept arbitrary avatar text', () => {
  const group = createGroup([], 'Synthetic avatar group');
  const player = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', name: 'Alex', avatar: 'fox' };
  assert.deepEqual(addPlayer(group, player).players, [player]);
  assert.throws(() => addPlayer(group, { ...player, avatar: 'unknown' }), AvatarError);
  assert.equal(group.players.length, 0);
});
