import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addPlayer, createGroup, deleteGame, formatMoney, getStandings,
  parseScore, parseWager, recordResult, startGame, ValidationError,
} from './groups.ts';

function fixture() {
  let group = createGroup([], 'Test group');
  for (const name of ['Alex', 'Blair', 'Casey', 'Drew', 'Emery']) {
    group = addPlayer(group, name);
  }
  return group;
}

function teams(group) {
  return group.players.map((player) => player.id);
}

function game(group, wager = '5') {
  const ids = teams(group);
  return startGame(group, ids.slice(0, 2), ids.slice(2, 4), wager);
}

function complete(group, a = '11', b = '7', wager = '5') {
  const started = game(group, wager);
  return recordResult(started, started.games.at(-1).id, a, b);
}

test('groups and players are trimmed, unique within scope, and immutable', () => {
  const group = createGroup([], '  Friends  ');
  assert.equal(group.name, 'Friends');
  assert.throws(() => createGroup([group], 'friends'), ValidationError);
  assert.throws(() => createGroup([], ' '), ValidationError);
  const updated = addPlayer(group, ' Alex ');
  assert.equal(group.players.length, 0);
  assert.equal(updated.players[0]?.name, 'Alex');
  assert.throws(() => addPlayer(updated, 'alex'), ValidationError);
  assert.throws(() => addPlayer(group, ''), ValidationError);
  const another = createGroup([updated], 'Another');
  assert.notEqual(another.id, group.id);
  assert.equal(addPlayer(another, 'Alex').players.length, 1);
});

test('USD parsing uses integer cents, accepts zero, and formats signs precisely', () => {
  for (const [input, expected] of [['0', 0], ['5', 500], ['5.2', 520], [' 0.29 ', 29], ['5.25', 525]]) {
    assert.equal(parseWager(input), expected);
  }
  for (const input of ['', ' ', '-5', '1.001', 'NaN', 'Infinity', '1e2', '$5', '5,25', '.5', '90071992547410']) {
    assert.throws(() => parseWager(input), ValidationError, input);
  }
  assert.equal(formatMoney(500), '$5.00');
  assert.equal(formatMoney(-525), '-$5.25');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(9007199254740991), '$90071992547409.91');
  assert.throws(() => formatMoney(1.5), ValidationError);
  assert.throws(() => formatMoney(Infinity), ValidationError);
});

test('score parsing rejects invalid input without imposing target or win-by-two rules', () => {
  assert.equal(parseScore(' 0 '), 0);
  assert.equal(parseScore('12'), 12);
  for (const input of ['', '-1', '2.5', '1e2', 'NaN', 'Infinity', '9007199254740992']) {
    assert.throws(() => parseScore(input), ValidationError);
  }
  assert.equal(complete(fixture(), '1', '0').games[0]?.status, 'completed');
  assert.equal(complete(fixture(), '12', '11').games[0]?.status, 'completed');
});

test('game setup requires exactly four distinct group members and freezes the wager', () => {
  const group = fixture();
  const ids = teams(group);
  for (const [a, b] of [
    [ids.slice(0, 1), ids.slice(2, 4)],
    [ids.slice(0, 3), ids.slice(2, 4)],
    [[ids[0], ids[0]], ids.slice(2, 4)],
    [ids.slice(0, 2), [ids[0], ids[3]]],
    [ids.slice(0, 2), [ids[2], 'outsider']],
  ]) {
    assert.throws(() => startGame(group, a, b, '5'), ValidationError);
  }
  assert.throws(() => game(group, '-1'), ValidationError);
  const pending = game(group);
  assert.equal(pending.games[0]?.wagerCents, 500);
  assert.equal(pending.games[0]?.status, 'pending');
  assert.equal(group.games.length, 0);
  assert.ok(getStandings(pending).every((row) => row.rank === null && row.moneyCents === 0));
  const second = game(pending, '10');
  assert.equal(second.games[0]?.wagerCents, 500);
  assert.equal(second.games[1]?.wagerCents, 1000);
});

test('11-7 at $5 applies per-player wins, differential and money with shared ranks', () => {
  const group = complete(fixture());
  const rows = getStandings(group);
  assert.deepEqual(rows.map(({ wins, losses, pointDifferential, moneyCents, rank }) =>
    [wins, losses, pointDifferential, moneyCents, rank]), [
    [1, 0, 4, 500, 1], [1, 0, 4, 500, 1],
    [0, 1, -4, -500, 3], [0, 1, -4, -500, 3],
    [0, 0, 0, 0, null],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.moneyCents, 0), 0);
  assert.equal(rows.reduce((sum, row) => sum + row.pointDifferential, 0), 0);
});

test('team B can win and a zero wager affects standings without changing money', () => {
  const rows = getStandings(complete(fixture(), '3', '11', '0'));
  assert.equal(rows[0]?.player.name, 'Casey');
  assert.equal(rows[0]?.wins, 1);
  assert.equal(rows[0]?.pointDifferential, 8);
  assert.ok(rows.every((row) => row.moneyCents === 0));
});

test('changing partners aggregates by individual and breaks equal wins by differential', () => {
  let group = complete(fixture());
  const [a, b, c, d] = teams(group);
  group = startGame(group, [a, c], [b, d], '2.25');
  group = recordResult(group, group.games[1].id, '11', '9');
  const rows = getStandings(group);
  assert.deepEqual(rows.map((row) => [row.player.name, row.wins, row.pointDifferential, row.moneyCents, row.rank]), [
    ['Alex', 2, 6, 725, 1], ['Blair', 1, 2, 275, 2],
    ['Casey', 1, -2, -275, 3], ['Drew', 0, -6, -725, 4],
    ['Emery', 0, 0, 0, null],
  ]);
});

test('rank prioritizes wins over point differential', () => {
  let group = complete(fixture(), '1', '0');
  group = complete(group, '1', '0');
  group = complete(group, '0', '100');
  const rows = getStandings(group);
  assert.equal(rows[0]?.wins, 2);
  assert.equal(rows[0]?.pointDifferential, -98);
  assert.equal(rows[2]?.wins, 1);
  assert.equal(rows[2]?.pointDifferential, 98);
});

test('results reject missing games, duplicate submissions, ties and invalid scores', () => {
  const pending = game(fixture());
  const id = pending.games[0].id;
  assert.throws(() => recordResult(pending, 'missing', '11', '0'), ValidationError);
  assert.throws(() => recordResult(pending, id, '11', '11'), ValidationError);
  assert.throws(() => recordResult(pending, id, '-1', '11'), ValidationError);
  const completed = recordResult(pending, id, '11', '5');
  assert.throws(() => recordResult(completed, id, '11', '5'), ValidationError);
  assert.equal(pending.games[0]?.status, 'pending');
});

test('deletion reverses standings and game IDs are not reused', () => {
  const completed = complete(fixture());
  const id = completed.games[0].id;
  const deleted = deleteGame(completed, id);
  assert.ok(getStandings(deleted).every((row) =>
    row.wins === 0 && row.losses === 0 && row.pointDifferential === 0 && row.moneyCents === 0 && row.rank === null));
  assert.throws(() => deleteGame(deleted, id), ValidationError);
  const replacement = game(deleted);
  assert.notEqual(replacement.games[0]?.id, id);
  assert.equal(deleteGame(replacement, replacement.games[0].id).games.length, 0);
  assert.equal(completed.games.length, 1);
});

test('groups have independent players, games and ledgers', () => {
  const first = complete(fixture());
  const second = createGroup([first], 'Second');
  assert.deepEqual(getStandings(second), []);
  assert.equal(second.games.length, 0);
  assert.equal(getStandings(first)[0]?.moneyCents, 500);
});

test('score and money accumulation reject unsafe totals without changing the group', () => {
  const maximum = '9007199254740991';
  const scored = complete(fixture(), maximum, '0', '0');
  const pending = game(scored, '0');
  assert.throws(() => recordResult(pending, pending.games[1].id, '1', '0'), ValidationError);
  const wagered = complete(fixture(), '1', '0', '90071992547409.91');
  const moneyPending = game(wagered, '0.01');
  assert.throws(() => recordResult(moneyPending, moneyPending.games[1].id, '1', '0'), ValidationError);
  assert.equal(pending.games[1]?.status, 'pending');
  assert.equal(moneyPending.games[1]?.status, 'pending');
});

test('deleting a result preserves other completed results', () => {
  let group = complete(fixture(), '11', '7', '5');
  group = complete(group, '2', '11', '1');
  group = deleteGame(group, group.games[0].id);
  const alex = getStandings(group).find((row) => row.player.name === 'Alex');
  assert.deepEqual([alex.wins, alex.losses, alex.pointDifferential, alex.moneyCents], [0, 1, -9, -100]);
});
