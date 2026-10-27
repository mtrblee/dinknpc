import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addGuestPlayer, addPlayer, createGroup, currencySymbol, deleteGame, formatMoney, formatUnits, getPlayerDisplayName, getPlayerLabel, getStandings,
  parseScore, parseWager, recordResult, removePlayer, startGame, validateCurrency, validatePlayerId, ValidationError,
  validatePlayerCode, validatePlayerReference, getPlayerReference,
} from './groups.ts';
import { createTournament } from './tournaments.ts';
import { AVATARS, isAvatar } from './avatars.ts';
import { DEFAULT_GROUP_AVATAR, getGroupAvatar, GROUP_AVATARS, GroupAvatarError, validateGroupAvatar } from './groupAvatars.ts';

test('shareable codes normalize case without replacing UUIDs or allowing ambiguous and malformed aliases', () => {
  assert.equal(validatePlayerCode(' k7m2q9 '), 'K7M2Q9');
  assert.equal(validatePlayerReference(' k7m2q9 '), 'K7M2Q9');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  assert.equal(validatePlayerReference(` ${id.toUpperCase()} `), id);
  assert.throws(() => validatePlayerId('K7M2Q9'), ValidationError);
  for (const value of ['', 'ABC', 'ABCDEFG', 'ABC123', 'ABC0DE', 'ABCIDE', 'ABCODE', 'ABC-DE', 'AB CDE', 'AB\u00dfDE', '\u212a7M2Q9']) {
    assert.throws(() => validatePlayerReference(value), ValidationError, value);
  }
});

test('duplicate-name labels prefer codes but retain UUID-based teams, results, ranks and simulated totals', () => {
  const original = complete(fixture(), '11', '5', '1');
  const codes = ['K7M2Q9', 'ABCD23', 'XYZ789', 'TESTAA', 'TESTAB'];
  const coded = { ...original, players: original.players.map((player, index) => ({ ...player, name: 'Alex', code: codes[index] })) };
  assert.equal(getPlayerLabel(coded, coded.players[0]), 'Alex (K7M2Q9)');
  assert.deepEqual(coded.games, original.games);
  assert.deepEqual(getStandings(coded).map(({ player, ...standing }) => standing), getStandings(original).map(({ player, ...standing }) => standing));
  assert.deepEqual(deleteGame(coded, original.games[0].id).games, []);
  const guest = { ...coded.players[0], isGuest: true };
  assert.equal(getPlayerReference(guest), guest.id);
  assert.equal(getPlayerReference({ ...guest, isGuest: false, isDeleted: true }), guest.id);
  assert.equal(getPlayerReference(original.players[0]), original.players[0].id);
  const added = addPlayer(createGroup([], 'Codes'), { ...coded.players[0], code: ' k7m2q9 ' });
  assert.equal(added.players[0].code, 'K7M2Q9');
  assert.equal(added.players[0].id, coded.players[0].id);
});

test('new groups default to None and a separate validated group avatar catalog', () => {
  const group = createGroup([], 'Options');
  assert.equal(group.currency, 'none');
  assert.equal(group.avatar, DEFAULT_GROUP_AVATAR);
  assert.equal(new Set(GROUP_AVATARS.map((entry) => entry.id)).size, GROUP_AVATARS.length);
  for (const avatar of GROUP_AVATARS) {
    assert.equal(validateGroupAvatar(avatar.id), avatar.id);
    assert.deepEqual(getGroupAvatar(avatar.id), avatar);
    assert.equal(isAvatar(avatar.id), false);
    assert.ok(!AVATARS.some((player) => player.emoji === avatar.emoji));
    for (const currency of ['none', 'money', 'boba']) {
      const selected = createGroup([], 'Options', currency, avatar.id);
      assert.equal(selected.currency, currency);
      assert.equal(selected.avatar, avatar.id);
    }
  }
  for (const invalid of [null, '', 'USD', 'Money', 'boba ', 0]) {
    assert.throws(() => createGroup([], 'Options', invalid), ValidationError);
    assert.throws(() => validateCurrency(invalid), ValidationError);
  }
  for (const invalid of [undefined, null, 'smile', 'unknown', 'paddles ', 0]) {
    assert.throws(() => validateGroupAvatar(invalid), GroupAvatarError);
    assert.throws(() => getGroupAvatar(invalid), GroupAvatarError);
  }
  assert.throws(() => createGroup([], 'Options', 'none', 'smile'), GroupAvatarError);
});

test('currency parsing defaults blank to zero, keeps integer units and rejects invalid precision', () => {
  for (const currency of ['none', 'money', 'boba']) {
    for (const value of ['', ' ', '\t', '0']) assert.equal(parseWager(value, currency), 0);
  }
  assert.equal(parseWager('0.00', 'none'), 0);
  assert.equal(parseWager('90071992547409', 'money'), 9007199254740900);
  assert.equal(parseWager(' 02 ', 'boba'), 2);
  assert.equal(parseWager(String(Number.MAX_SAFE_INTEGER), 'boba'), Number.MAX_SAFE_INTEGER);
  for (const value of ['-1', '1.5', '1.0', '.5', '1e2', 'NaN', 'Infinity', '1,000', '9007199254740992']) {
    assert.throws(() => parseWager(value, 'boba'), ValidationError, value);
  }
  for (const value of ['-1', '1', '0.01', 'NaN']) assert.throws(() => parseWager(value, 'none'), ValidationError);
  assert.throws(() => parseWager('90071992547409.92', 'money'), ValidationError);
  assert.throws(() => parseWager('', 'unknown'), ValidationError);
  assert.equal(formatUnits(525, 'money'), '$5.25');
  assert.equal(formatUnits(-2, 'boba'), '-2');
  assert.equal(formatUnits(0, 'boba'), '0');
  assert.equal(currencySymbol('money'), '\u{1F4B5}');
  assert.equal(currencySymbol('boba'), '\u{1F9CB}');
  assert.throws(() => formatUnits(1.5, 'boba'), ValidationError);
  assert.throws(() => formatUnits(Infinity, 'boba'), ValidationError);
  assert.throws(() => formatUnits(0, 'none'), ValidationError);
  assert.throws(() => currencySymbol('none'), ValidationError);
});

test('each currency preserves doubles rules, shared ranks, zero-sum totals and deletion recalculation', () => {
  for (const [currency, wager, units] of [['none', '', 0], ['money', '1', 100], ['boba', '2', 2]]) {
    const group = { ...fixture(), currency, avatar: 'mountain' };
    const pending = game(group, wager);
    assert.equal(pending.games[0].wagerUnits, units);
    assert.equal(pending.avatar, 'mountain');
    assert.ok(getStandings(pending).every((row) => row.netUnits === 0));
    const completed = recordResult(pending, pending.games[0].id, '11', '7');
    const played = getStandings(completed).filter((row) => row.rank !== null);
    assert.deepEqual(played.map((row) => row.rank), [1, 1, 3, 3]);
    assert.deepEqual(played.map((row) => row.pointDifferential), [4, 4, -4, -4]);
    assert.ok(played.every((row) => Math.abs(row.netUnits) === units));
    assert.equal(played.reduce((sum, row) => sum + row.netUnits, 0), 0);
    assert.ok(getStandings(deleteGame(completed, completed.games[0].id)).every((row) => row.netUnits === 0 && row.rank === null));
    if (currency === 'none') assert.throws(() => game(group, '1'), ValidationError);
    for (const invalid of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => getStandings({ ...pending, games: [{ ...pending.games[0], wagerUnits: invalid }] }), ValidationError);
    }
  }
  const boba = { ...fixture(), currency: 'boba' };
  const completed = complete(boba, '11', '7', String(Number.MAX_SAFE_INTEGER));
  const next = game(completed, '1');
  assert.throws(() => recordResult(next, next.games.at(-1).id, '11', '7'), ValidationError);
  assert.equal(next.games.at(-1).status, 'pending');
  const invalidNone = { ...game(fixture()), currency: 'none' };
  assert.throws(() => getStandings(invalidNone), ValidationError);
});

function player(number, name) {
  return { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`, name };
}

function fixture() {
  let group = createGroup([], 'Test group', 'money');
  for (const [index, name] of ['Alex', 'Blair', 'Casey', 'Drew', 'Emery'].entries()) {
    group = addPlayer(group, player(index + 1, name));
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

test('guest names are unique within a group ignoring case and outer spaces, independently of registered names', () => {
  const original = addPlayer(createGroup([], 'Guest group', 'money'), player(1, 'Alex'));
  let group = addGuestPlayer(original, player(2).id, '  Alex  ');
  assert.equal(original.players.length, 1);
  const guest = group.players[1];
  assert.deepEqual(guest, { id: player(2).id, name: 'Alex', isGuest: true });
  assert.equal(getPlayerDisplayName(guest), '(g) Alex');
  assert.equal(getPlayerLabel(group, guest), '(g) Alex');
  assert.equal(getPlayerLabel(group, group.players[0]), 'Alex');
  for (const name of ['Alex', 'alex', '  ALEX  ']) {
    assert.throws(() => addGuestPlayer(group, player(3).id, name), /guest with that name/);
  }
  const legacy = { ...group, players: [...group.players, { ...guest, id: player(3).id, name: 'alex' }] };
  assert.equal(getPlayerLabel(legacy, guest), `(g) Alex (${guest.id})`);
  assert.equal(addPlayer(group, player(3, 'Alex')).players.length, 3);
  assert.throws(() => addGuestPlayer(group, player(4).id, '  '), ValidationError);
  assert.throws(() => addGuestPlayer(group, 'invalid-id', 'Guest'), ValidationError);
  assert.throws(() => addGuestPlayer(group, guest.id, 'Another name'), ValidationError);
  assert.throws(() => addPlayer(createGroup([], 'Other', 'money'), guest), ValidationError);
});

test('mixed and all-guest doubles retain distinct-player validation, shared ranks, zero-sum money and deletion recalculation', () => {
  for (const guestsOnly of [false, true]) {
    let group = createGroup([], 'Guest doubles', 'money');
    for (let index = 1; index <= 4; index++) {
      group = guestsOnly || index > 1 ? addGuestPlayer(group, player(index).id, `Guest ${index}`) : addPlayer(group, player(index, 'Member'));
    }
    const ids = teams(group);
    assert.throws(() => startGame(group, ids.slice(0, 2), [ids[0], ids[3]], '5'), ValidationError);
    const pending = game(group);
    assert.throws(() => recordResult(pending, pending.games[0].id, '11', '11'), ValidationError);
    assert.ok(getStandings(pending).every((row) => row.rank === null));
    const completed = recordResult(pending, pending.games[0].id, '11', '7');
    const rows = getStandings(completed);
    assert.equal(rows.filter((row) => row.player.isGuest).length, guestsOnly ? 4 : 3);
    assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3, 3]);
    assert.equal(rows.reduce((sum, row) => sum + row.netUnits, 0), 0);
    assert.ok(rows.every((row) => Math.abs(row.netUnits) === 500 && Math.abs(row.pointDifferential) === 4));
    const deleted = deleteGame(completed, completed.games[0].id);
    assert.deepEqual(deleted.players, group.players);
    assert.ok(getStandings(deleted).every((row) => row.rank === null && row.netUnits === 0));
  }
});

test('guest participants remain scoped to their own group even when names match', () => {
  const one = addGuestPlayer(createGroup([], 'One', 'money'), player(1).id, 'Visitor');
  let two = createGroup([one], 'Two', 'money');
  for (let index = 2; index <= 5; index++) two = addGuestPlayer(two, player(index).id, index === 2 ? 'Visitor' : `Visitor ${index}`);
  assert.throws(() => startGame(two, [one.players[0].id, two.players[0].id], teams(two).slice(1, 3), '0'), ValidationError);
  assert.equal(getStandings(one)[0].rank, null);
  assert.equal(getStandings(complete(two))[0].wins, 1);
  assert.equal(getStandings(one)[0].wins, 0);
});

test('removal rejects any game or tournament participant but preserves unrelated results and names can be reused', () => {
  const group = addGuestPlayer(fixture(), player(6).id, 'Visitor');
  for (const invalid of ['invalid', player(99).id]) {
    assert.throws(() => removePlayer(group, invalid, []), ValidationError);
  }
  const pending = game(group);
  const completed = recordResult(pending, pending.games[0].id, '11', '7');
  for (const state of [pending, completed]) {
    for (const id of teams(group).slice(0, 4)) assert.throws(() => removePlayer(state, id, []), /game or tournament/);
  }
  const removed = removePlayer(completed, player(6).id.toUpperCase(), []);
  assert.equal(group.players.length, 6);
  assert.equal(removed.players.length, 5);
  assert.deepEqual(removed.games, completed.games);
  assert.deepEqual(getStandings(removed).filter((row) => row.rank !== null), getStandings(completed).filter((row) => row.rank !== null));
  const replacement = addGuestPlayer(removed, player(7).id, 'VISITOR');
  assert.equal(replacement.players.at(-1).id, player(7).id);
  const regularRemoved = removePlayer(removed, player(5).id, []);
  assert.equal(addPlayer(regularRemoved, player(5, 'Emery')).players.length, 5);
  const tournament = createTournament(group, 'dddddddd-dddd-4ddd-8ddd-000000000001', 'Test cup',
    [[player(1).id, player(2).id], [player(3).id, player(6).id]]).tournament;
  assert.throws(() => removePlayer(group, player(6).id, [tournament]), /game or tournament/);
  assert.equal(removePlayer(group, player(5).id, [tournament]).players.length, 5);
});

test('group names and account identities are unique within scope and immutable', () => {
  const group = createGroup([], '  Friends  ', 'money');
  assert.equal(group.name, 'Friends');
  assert.throws(() => createGroup([group], 'friends', 'money'), ValidationError);
  assert.throws(() => createGroup([], ' ', 'money'), ValidationError);
  const updated = addPlayer(group, player(1, ' Alex '));
  assert.equal(group.players.length, 0);
  assert.equal(updated.players[0]?.name, 'Alex');
  assert.equal(updated.players[0]?.id, player(1, 'Alex').id);
  assert.throws(() => addPlayer(updated, player(1, 'Different name')), ValidationError);
  assert.throws(() => addPlayer(group, player(1, '')), ValidationError);
  assert.throws(() => addPlayer(group, { id: 'unregistered-name', name: 'Alex' }), ValidationError);
  const another = createGroup([updated], 'Another', 'money');
  assert.notEqual(another.id, group.id);
  assert.equal(addPlayer(another, player(1, 'Alex')).players.length, 1);
});

test('player IDs normalize pasted UUIDs and matching names are disambiguated across the group', () => {
  const alex = player(1, 'Alex');
  const anotherAlex = player(2, 'alex');
  assert.equal(validatePlayerId(` ${alex.id.toUpperCase()} `), alex.id);
  for (const id of ['', 'Alex', 'alex@example.test', 'aaaaaaaa', `${alex.id}extra`]) {
    assert.throws(() => validatePlayerId(id), ValidationError);
  }
  let group = addPlayer(createGroup([], 'Friends', 'money'), alex);
  assert.equal(getPlayerLabel(group, alex), 'Alex');
  group = addPlayer(group, anotherAlex);
  assert.equal(getPlayerLabel(group, alex), `Alex (${alex.id})`);
  assert.equal(getPlayerLabel(group, anotherAlex), `alex (${anotherAlex.id})`);
  assert.throws(() => addPlayer(group, { ...alex, id: alex.id.toUpperCase() }), ValidationError);
});

test('new USD wagers require whole dollars with a one-dollar minimum or zero, while formatting preserves legacy cents', () => {
  for (const [input, expected] of [['', 0], [' ', 0], ['0', 0], ['1', 100], ['5', 500], [' 2 ', 200], ['01', 100]]) {
    assert.equal(parseWager(input, 'money'), expected);
  }
  for (const input of ['-5', '0.01', '0.99', '1.01', '1.25', '5.2', '1.00', '0.00', '1.001',
    'NaN', 'Infinity', '1e2', '$5', '5,25', '.5', '90071992547410']) {
    assert.throws(() => parseWager(input, 'money'), ValidationError, input);
  }
  assert.equal(formatMoney(500), '$5.00');
  assert.equal(formatMoney(-525), '-$5.25');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(9007199254740991), '$90071992547409.91');
  assert.throws(() => formatMoney(1.5), ValidationError);
  assert.throws(() => formatMoney(Infinity), ValidationError);
});

test('previously saved cent wagers can still be scored and combined with whole-dollar games without rounding', () => {
  const started = game(fixture(), '1');
  const legacy = { ...started, games: [{ ...started.games[0], wagerUnits: 125 }] };
  assert.ok(getStandings(legacy).every((row) => row.netUnits === 0));
  let group = recordResult(legacy, legacy.games[0].id, '11', '7');
  assert.deepEqual(getStandings(group).map((row) => row.netUnits), [125, 125, -125, -125, 0]);
  group = complete(group, '7', '11', '1');
  assert.equal(group.games[0].wagerUnits, 125);
  const alex = getStandings(group).find((row) => row.player.name === 'Alex');
  assert.equal(alex.netUnits, 25);
  assert.equal(formatMoney(alex.netUnits), '$0.25');
  assert.equal(getStandings(group).reduce((sum, row) => sum + row.netUnits, 0), 0);
  const removed = deleteGame(group, legacy.games[0].id);
  assert.equal(getStandings(removed).find((row) => row.player.name === 'Alex').netUnits, -100);
  assert.equal(legacy.games[0].status, 'pending');
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
  assert.equal(pending.games[0]?.wagerUnits, 500);
  assert.equal(pending.games[0]?.status, 'pending');
  assert.equal(group.games.length, 0);
  assert.ok(getStandings(pending).every((row) => row.rank === null && row.netUnits === 0));
  const second = game(pending, '10');
  assert.equal(second.games[0]?.wagerUnits, 500);
  assert.equal(second.games[1]?.wagerUnits, 1000);
});

test('persistent game counters cannot allocate unsafe or invalid identifiers', () => {
  for (const nextGameNumber of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity]) {
    assert.throws(() => game({ ...fixture(), nextGameNumber }), ValidationError);
  }
});
test('11-7 at $5 applies per-player wins, differential and money with shared ranks', () => {
  const group = complete(fixture());
  const rows = getStandings(group);
  assert.deepEqual(rows.map(({ wins, losses, pointDifferential, netUnits, rank }) =>
    [wins, losses, pointDifferential, netUnits, rank]), [
    [1, 0, 4, 500, 1], [1, 0, 4, 500, 1],
    [0, 1, -4, -500, 3], [0, 1, -4, -500, 3],
    [0, 0, 0, 0, null],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.netUnits, 0), 0);
  assert.equal(rows.reduce((sum, row) => sum + row.pointDifferential, 0), 0);
});

test('team B can win and a zero wager affects standings without changing money', () => {
  const rows = getStandings(complete(fixture(), '3', '11', '0'));
  assert.equal(rows[0]?.player.name, 'Casey');
  assert.equal(rows[0]?.wins, 1);
  assert.equal(rows[0]?.pointDifferential, 8);
  assert.ok(rows.every((row) => row.netUnits === 0));
});

test('changing partners aggregates by individual and breaks equal wins by differential', () => {
  let group = complete(fixture());
  const [a, b, c, d] = teams(group);
  group = startGame(group, [a, c], [b, d], '2');
  group = recordResult(group, group.games[1].id, '11', '9');
  const rows = getStandings(group);
  assert.deepEqual(rows.map((row) => [row.player.name, row.wins, row.pointDifferential, row.netUnits, row.rank]), [
    ['Alex', 2, 6, 700, 1], ['Blair', 1, 2, 300, 2],
    ['Casey', 1, -2, -300, 3], ['Drew', 0, -6, -700, 4],
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
    row.wins === 0 && row.losses === 0 && row.pointDifferential === 0 && row.netUnits === 0 && row.rank === null));
  assert.throws(() => deleteGame(deleted, id), ValidationError);
  const replacement = game(deleted);
  assert.notEqual(replacement.games[0]?.id, id);
  assert.equal(deleteGame(replacement, replacement.games[0].id).games.length, 0);
  assert.equal(completed.games.length, 1);
});

test('groups have independent players, games and ledgers', () => {
  const first = complete(fixture());
  const second = createGroup([first], 'Second', 'money');
  assert.deepEqual(getStandings(second), []);
  assert.equal(second.games.length, 0);
  assert.equal(getStandings(first)[0]?.netUnits, 500);
});

test('score and money accumulation reject unsafe totals without changing the group', () => {
  const maximum = '9007199254740991';
  const scored = complete(fixture(), maximum, '0', '0');
  const pending = game(scored, '0');
  assert.throws(() => recordResult(pending, pending.games[1].id, '1', '0'), ValidationError);
  const wagered = complete(fixture(), '1', '0', '90071992547409');
  const moneyPending = game(wagered, '1');
  assert.throws(() => recordResult(moneyPending, moneyPending.games[1].id, '1', '0'), ValidationError);
  assert.equal(pending.games[1]?.status, 'pending');
  assert.equal(moneyPending.games[1]?.status, 'pending');
});

test('deleting a result preserves other completed results', () => {
  let group = complete(fixture(), '11', '7', '5');
  group = complete(group, '2', '11', '1');
  group = deleteGame(group, group.games[0].id);
  const alex = getStandings(group).find((row) => row.player.name === 'Alex');
  assert.deepEqual([alex.wins, alex.losses, alex.pointDifferential, alex.netUnits], [0, 1, -9, -100]);
});

test('all shared leaders remain rank one, with pending and unplayed members excluded', () => {
  let group = complete(fixture());
  group = complete(group, '7', '11');
  const tied = getStandings(group);
  assert.deepEqual(tied.map((row) => row.rank), [1, 1, 1, 1, null]);
  assert.deepEqual(tied.filter((row) => row.rank === 1).map((row) => row.player.name),
    ['Alex', 'Blair', 'Casey', 'Drew']);

  group = game(group, '10');
  assert.deepEqual(getStandings(group), tied);
  group = deleteGame(group, group.games[1].id);
  assert.deepEqual(getStandings(group).map((row) => row.rank), [1, 1, 3, 3, null]);
  group = deleteGame(group, group.games[0].id);
  assert.ok(getStandings(group).every((row) => row.rank === null && row.netUnits === 0));
});

test('players sharing wins and differential keep a shared lead despite different losses and net', () => {
  let group = complete(fixture());
  const [alex, blair, casey, drew, emery] = teams(group);
  group = startGame(group, [alex, casey], [drew, emery], '3');
  group = recordResult(group, group.games.at(-1).id, '4', '0');
  group = startGame(group, [blair, casey], [alex, drew], '1');
  group = recordResult(group, group.games.at(-1).id, '2', '0');

  assert.deepEqual(getStandings(group).map((row) => [
    row.player.name, row.rank, row.wins, row.losses, row.pointDifferential, row.netUnits,
  ]), [
    ['Alex', 1, 2, 1, 6, 700],
    ['Blair', 1, 2, 0, 6, 600],
    ['Casey', 3, 2, 1, 2, -100],
    ['Emery', 4, 0, 1, -4, -300],
    ['Drew', 5, 0, 3, -10, -900],
  ]);
});

test('populated leaderboards stay independent with matching player names and result deletion', () => {
  const first = complete(fixture());
  let second = createGroup([first], 'Another court', 'money');
  for (const player of first.players) {
    second = addPlayer(second, player);
  }
  second = complete(second, '7', '11', '2');
  const secondStandings = getStandings(second);

  assert.deepEqual(getStandings(first).filter((row) => row.rank === 1).map((row) => row.player.name),
    ['Alex', 'Blair']);
  assert.deepEqual(secondStandings.filter((row) => row.rank === 1).map((row) => row.player.name),
    ['Casey', 'Drew']);
  assert.equal(getStandings(first)[0].netUnits, 500);
  assert.equal(secondStandings[0].netUnits, 200);

  const cleared = deleteGame(first, first.games[0].id);
  assert.ok(getStandings(cleared).every((row) => row.rank === null));
  assert.deepEqual(getStandings(second), secondStandings);
});
