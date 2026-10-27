import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anonymizeParticipant } from './accountDeletion.ts';
import { addPlayer, createGroup, deleteGame, getStandings, recordResult, startGame, ValidationError } from './groups.ts';
import { changeTournament, createTournament, getPoolStandings, parseTournament, startPlayoffs, tournamentPhase } from './tournaments.ts';

const id = (index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
const tournamentId = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
function fixture(count = 4, currency = 'money') {
  let group = createGroup([], 'Synthetic shared scores', currency);
  for (let index = 1; index <= count; index++) group = addPlayer(group, { id: id(index), name: `Synthetic ${index}`, avatar: 'fox' });
  return group;
}
const totals = (group) => getStandings(group).map(({ player, ...row }) => row);

test('anonymization retains exact scores, ranks, zero-sum totals, timestamps, and other players', () => {
  for (const currency of ['none', 'money', 'boba']) {
    let group = startGame(fixture(4, currency), [id(1), id(2)], [id(3), id(4)], currency === 'none' ? '0' : '2');
    if (currency === 'money') group = { ...group, games: group.games.map((game) => ({ ...game, wagerUnits: 25 })) };
    group = recordResult(group, group.games[0].id, '11', '7');
    group = { ...group, players: group.players.map((player, index) => index === 0 ? { ...player, code: 'K7M2Q9' } : player) };
    group = { ...group, games: group.games.map((game) => ({
      ...game, createdAt: '2026-10-22T12:00:00.000Z', completedAt: '2026-10-22T12:10:00.000Z',
    })) };
    const saved = structuredClone(group);
    const result = anonymizeParticipant(group, [], id(1).toUpperCase(), id(90));
    assert.deepEqual(group, saved);
    assert.equal(result.group.nextGameNumber, group.nextGameNumber);
    assert.deepEqual(totals(result.group), totals(group));
    assert.equal(getStandings(result.group).reduce((sum, row) => sum + row.netUnits, 0), 0);
    assert.deepEqual(result.anonymous, { id: id(90), name: 'Deleted player', avatar: 'smile', isDeleted: true });
    assert.deepEqual(result.group.players.slice(1), group.players.slice(1));
    assert.deepEqual(result.group.games[0], { ...group.games[0], teamA: [id(90), id(2)] });
    assert.ok(!JSON.stringify(result).includes(id(1)));
    assert.ok(!JSON.stringify(result).includes('Synthetic 1'));
    assert.ok(!JSON.stringify(result).includes('K7M2Q9'));
    assert.throws(() => startGame(result.group, [id(90), id(2)], [id(3), id(4)], '0'), /Deleted players/);
    assert.throws(() => addPlayer(fixture(), result.anonymous), /Deleted players/);
    assert.ok(getStandings(deleteGame(result.group, group.games[0].id)).every((row) => row.rank === null && row.netUnits === 0));
  }
});

test('unused memberships disappear without retaining anonymous roster entries', () => {
  const group = fixture();
  const result = anonymizeParticipant(group, [], id(1), id(90));
  assert.equal(result.anonymous, null);
  assert.deepEqual(result.group.players, group.players.slice(1));
  assert.deepEqual(result.group.games, []);
  assert.equal(result.group.nextGameNumber, group.nextGameNumber);
});

test('invalid identities, guests, and already deleted players cannot be anonymized as accounts', () => {
  const group = fixture();
  for (const target of ['invalid', id(80)]) assert.throws(() => anonymizeParticipant(group, [], target, id(90)), ValidationError);
  for (const replacement of ['invalid', id(1), id(2)]) assert.throws(() => anonymizeParticipant(group, [], id(1), replacement), ValidationError);
  for (const marker of [{ isGuest: true }, { isDeleted: true }]) {
    assert.throws(() => anonymizeParticipant({ ...group, players: group.players.map((player, index) =>
      index === 0 ? { ...player, ...marker } : player) }, [], id(1), id(90)), ValidationError);
  }
});

test('existing tournaments with 2-8 teams finish and reset with anonymous fixed participants but new tournaments reject them', () => {
  for (let count = 2; count <= 8; count++) {
    const group = fixture(count * 2);
    const pairs = Array.from({ length: count }, (_, index) => [id(index * 2 + 1), id(index * 2 + 2)]);
    let state = createTournament(group, tournamentId, 'Synthetic cup', pairs);
    const anonymous = anonymizeParticipant(state.group, [state.tournament], id(1), id(90));
    state = { group: anonymous.group, tournament: anonymous.tournaments[0] };
    assert.ok(!JSON.stringify(state).includes(id(1)));
    assert.throws(() => createTournament(state.group, tournamentId, 'New cup', [[id(90), id(2)], [id(3), id(4)]]), ValidationError);
    for (const match of state.tournament.pool) {
      state = changeTournament(state.group, state.tournament, { type: 'score', id: tournamentId, matchId: match.id, scoreA: '11', scoreB: '7' });
    }
    const before = totals(state.group);
    state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
    for (let attempts = 0; tournamentPhase(state.group, state.tournament) !== 'completed'; attempts++) {
      assert.ok(attempts < 8);
      const match = state.tournament.playoffs.find((entry) => state.group.games.some((game) => game.id === entry.gameId && game.status === 'pending'));
      assert.ok(match);
      state = changeTournament(state.group, state.tournament, { type: 'score', id: tournamentId, matchId: match.id, scoreA: '15', scoreB: '9' });
      parseTournament(state.tournament, state.group);
    }
    assert.equal(state.group.players[0].isDeleted, true);
    assert.ok(state.group.games.every((game) => game.wagerUnits === 0));
    state = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
    assert.deepEqual(totals(state.group), before);
    assert.ok(!JSON.stringify(state).includes(id(1)));
  }
});
