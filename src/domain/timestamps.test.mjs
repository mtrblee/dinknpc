import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatActivityTimestamp, formatGroupActivity, latestCompletedGameAt, parseActivityTimestamps, sortGroupsByActivity } from './timestamps.ts';
import { ValidationError } from './groups.ts';
import { summarizeGroup } from '../types/api.ts';

const createdAt = '2026-10-22T16:30:00.000Z';
const completedAt = '2026-10-23T15:45:00.000Z';
const local = (value) => new Date(value).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

test('group activity uses only known completed-game dates, independent of array order or newer pending games', () => {
  const games = [
    { status: 'completed', completedAt },
    { status: 'pending', createdAt: '2026-10-25T10:00:00.000Z' },
    { status: 'completed', completedAt: null },
    { status: 'completed', completedAt: createdAt },
    { status: 'completed' },
  ];
  assert.equal(latestCompletedGameAt(games), completedAt);
  assert.equal(latestCompletedGameAt(games.slice(1)), createdAt);
  assert.equal(latestCompletedGameAt(games.filter(game => !game.completedAt)), null);
  assert.equal(latestCompletedGameAt([]), null);
  assert.throws(() => latestCompletedGameAt([{ status: 'completed', completedAt: 'bad' }]), ValidationError);
  const summary = summarizeGroup({ id: 'synthetic', name: 'Activity', players: [], games });
  assert.equal(summary.completedGameCount, 4);
  assert.equal(summary.latestCompletedAt, completedAt);
});

test('activity sorting is newest first, stable for ties and undated groups, and never mutates its input', () => {
  const groups = Object.freeze([
    { id: 'empty', completedGameCount: 0, latestCompletedAt: null },
    { id: 'older', latestCompletedAt: createdAt },
    { id: 'historical', completedGameCount: 8, latestCompletedAt: null },
    { id: 'newest', latestCompletedAt: completedAt },
    { id: 'tied', latestCompletedAt: completedAt },
    { id: 'legacy' },
  ].map(Object.freeze));
  const sorted = sortGroupsByActivity(groups);
  assert.deepEqual(sorted.map(group => group.id), ['newest', 'tied', 'older', 'empty', 'historical', 'legacy']);
  assert.deepEqual(groups.map(group => group.id), ['empty', 'older', 'historical', 'newest', 'tied', 'legacy']);
  assert.equal(sorted[0], groups[3]);
  assert.deepEqual(sortGroupsByActivity([]), []);
  assert.throws(() => sortGroupsByActivity([{ latestCompletedAt: 'invalid' }]), ValidationError);
});

test('group activity labels show a local date, never invent historical dates, and distinguish no games', () => {
  assert.equal(formatGroupActivity({ completedGameCount: 1, latestCompletedAt: completedAt }),
    `Last completed: ${new Date(completedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`);
  assert.equal(formatGroupActivity({ completedGameCount: 0, latestCompletedAt: null }), 'No completed games');
  for (const latestCompletedAt of [null, undefined]) {
    assert.equal(formatGroupActivity({ completedGameCount: 2, latestCompletedAt }), 'Last completed: Date unavailable');
  }
  assert.throws(() => formatGroupActivity({ completedGameCount: 0, latestCompletedAt: completedAt }), ValidationError);
});

test('activity timestamps preserve UTC instants and explicit unknown historical dates', () => {
  assert.deepEqual(parseActivityTimestamps({}, false), {});
  assert.deepEqual(parseActivityTimestamps({ createdAt: null, completedAt: null }, true), { createdAt: null, completedAt: null });
  assert.deepEqual(parseActivityTimestamps({ createdAt, completedAt }, true), { createdAt, completedAt });
  assert.deepEqual(parseActivityTimestamps({ createdAt, completedAt: null }, false), { createdAt, completedAt: null });
  assert.deepEqual(parseActivityTimestamps({ createdAt: null, completedAt }, true), { createdAt: null, completedAt });
});

test('invalid, inconsistent and noncanonical timestamps are rejected explicitly', () => {
  for (const value of ['', 0, {}, '2026-02-30T12:00:00.000Z', '2026-10-22', '2026-10-22T16:30:00Z',
    '2026-10-22T12:30:00.000-04:00', '+010000-01-01T00:00:00.000Z', 'not a date']) {
    assert.throws(() => parseActivityTimestamps({ createdAt: value }, false), ValidationError);
    assert.throws(() => parseActivityTimestamps({ completedAt: value }, true), ValidationError);
    assert.throws(() => formatActivityTimestamp(false, { createdAt: value }), ValidationError);
  }
  assert.throws(() => parseActivityTimestamps({ createdAt, completedAt }, false), ValidationError);
  assert.throws(() => parseActivityTimestamps({ createdAt: completedAt, completedAt: createdAt }, true), ValidationError);
});

test('display switches from creation to completion in local time without inventing missing dates', () => {
  assert.equal(formatActivityTimestamp(false, { createdAt, completedAt }), `Created: ${local(createdAt)}`);
  assert.equal(formatActivityTimestamp(true, { createdAt, completedAt }), `Completed: ${local(completedAt)}`);
  assert.equal(formatActivityTimestamp(false, {}), 'Created: Time unavailable');
  assert.equal(formatActivityTimestamp(true, { createdAt }), 'Completed: Time unavailable');
  assert.equal(formatActivityTimestamp(true, { createdAt, completedAt: null }), 'Completed: Time unavailable');
  assert.equal(formatActivityTimestamp(false, { createdAt, completedAt: null }), `Created: ${local(createdAt)}`);
});
