import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, createGroup } from '../../domain/groups.ts';
import { changeTournament, createRotatingTournament, createTournament, getPoolStandings, matchWinner, startPlayoffs } from '../../domain/tournaments.ts';
import { getPlayoffLayout, playoffPlaceholder, tournamentMatchTitle } from './playoffBracketLayout.ts';

function fixture(count, seeded = true) {
  let group = { ...createGroup([], 'Synthetic bracket'), id: 'cccccccc-cccc-4ccc-8ccc-000000000001' };
  for (let index = 1; index <= count * 2; index++) {
    group = addPlayer(group, { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Player ${index}` });
  }
  let state = createTournament(group, 'dddddddd-dddd-4ddd-8ddd-000000000001', 'Bracket',
    Array.from({ length: count }, (_, index) => group.players.slice(index * 2, index * 2 + 2).map((player) => player.id)));
  if (!seeded) return state;
  for (const match of state.tournament.pool) {
    const aWins = Number(match.teamA.slice(5)) < Number(match.teamB.slice(5));
    state = changeTournament(state.group, state.tournament, {
      type: 'score', id: state.tournament.id, matchId: match.id, scoreA: aWins ? '11' : '7', scoreB: aWins ? '7' : '11',
    });
  }
  return startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
}

test('rotating schedules label rounds without introducing a playoff bracket or changing fixed pool labels', () => {
  for (const count of [4, 8]) {
    const fixed = fixture(count / 2, false);
    const { tournament } = createRotatingTournament(fixed.group, 'dddddddd-dddd-4ddd-8ddd-000000000002',
      'Synthetic rotating rounds', fixed.group.players.map(player => player.id));
    for (const match of tournament.pool) assert.equal(tournamentMatchTitle(tournament, match), `Round ${match.round}`);
    assert.deepEqual(getPlayoffLayout(tournament, 1).nodes, []);
    assert.equal(tournamentMatchTitle(fixed.tournament, fixed.tournament.pool[0]), 'Pool round 1');
  }
});

test('all supported brackets run left to right with centered feeders, nonoverlapping cards and room for large text', () => {
  for (let count = 2; count <= 8; count++) {
    const { tournament } = fixture(count);
    for (const scale of [1, 1.6, 2.5]) {
      const layout = getPlayoffLayout(tournament, scale);
      const rounds = Math.ceil(Math.log2(count));
      assert.equal(layout.rounds.length, rounds);
      assert.equal(layout.nodes.length, 2 ** rounds - 1);
      assert.equal(layout.cardWidth, 260);
      assert.equal(layout.cardHeight, Math.ceil(180 * scale));
      assert.ok(layout.cardHeight < 200 * scale, 'Compact cards must remain smaller at each text scale.');
      for (const round of layout.rounds) {
        const column = layout.nodes.filter((node) => node.match.round === round.round);
        assert.equal(column.length, 2 ** (rounds - round.round));
        column.forEach((node, index) => {
          assert.ok(node.left >= 0 && node.left + layout.cardWidth <= layout.width);
          assert.ok(node.top >= layout.headingHeight && node.top + layout.cardHeight <= layout.height);
          if (index) assert.ok(node.top > column[index - 1].top + layout.cardHeight);
          if (node.match.fromA) {
            const a = layout.nodes.find((entry) => entry.match.id === node.match.fromA);
            const b = layout.nodes.find((entry) => entry.match.id === node.match.fromB);
            assert.ok(a.left + layout.cardWidth < node.left);
            assert.equal(node.top, (a.top + b.top) / 2);
          }
        });
      }
      assert.equal(layout.lines.length, (layout.nodes.length - layout.nodes.filter((node) => node.match.round === 1).length) * 6);
      for (const line of layout.lines) {
        assert.ok(line.width > 0 && line.height > 0);
        assert.ok(line.left >= 0 && line.top >= 0 && line.left + line.width <= layout.width && line.top + line.height <= layout.height);
      }
      assert.equal(layout.rounds.at(-1).title, 'Championship');
    }
  }
  const eightTeams = getPlayoffLayout(fixture(8).tournament, 1);
  assert.deepEqual(eightTeams.rounds.map((round) => round.title), ['Quarterfinals', 'Semifinals', 'Championship']);
  assert.equal(eightTeams.height, 812);
  assert.equal(eightTeams.width, 860);
  assert.deepEqual(getPlayoffLayout(fixture(4).tournament, 1).rounds.map((round) => round.title), ['Semifinals', 'Championship']);
  assert.deepEqual(getPlayoffLayout(fixture(2).tournament, 1).rounds.map((round) => round.title), ['Championship']);
});

test('saved quarterfinal winners populate the correct semifinal and championship without speculative scores', () => {
  let state = fixture(8);
  const semifinals = state.tournament.playoffs.filter((match) => match.round === 2);
  assert.equal(playoffPlaceholder(state.tournament, semifinals[0], 'A'), 'Winner of Quarterfinal 1');
  assert.equal(playoffPlaceholder(state.tournament, semifinals[0], 'B'), 'Winner of Quarterfinal 2');
  const before = getPlayoffLayout(state.tournament, 1);
  for (const sourceId of [semifinals[0].fromA, semifinals[0].fromB]) {
    state = changeTournament(state.group, state.tournament, {
      type: 'score', id: state.tournament.id, matchId: sourceId, scoreA: '15', scoreB: '9',
    });
    const semi = state.tournament.playoffs.find((match) => match.id === semifinals[0].id);
    const source = state.tournament.playoffs.find((match) => match.id === sourceId);
    assert.equal(sourceId === semi.fromA ? semi.teamA : semi.teamB, matchWinner(state.group, source));
    if (sourceId === semi.fromA) { assert.equal(semi.teamB, null); assert.equal(semi.gameId, null); }
    else assert.equal(state.group.games.find((game) => game.id === semi.gameId).status, 'pending');
  }
  state = changeTournament(state.group, state.tournament, {
    type: 'score', id: state.tournament.id, matchId: semifinals[0].id, scoreA: '15', scoreB: '9',
  });
  const final = state.tournament.playoffs.at(-1);
  assert.equal(final.teamA, state.tournament.playoffs.find((match) => match.id === semifinals[0].id).teamA);
  assert.equal(final.teamB, null);
  assert.equal(final.gameId, null);
  assert.equal(playoffPlaceholder(state.tournament, final, 'B'), 'Winner of Semifinal 2');
  assert.equal(tournamentMatchTitle(state.tournament, final), 'Championship');
  assert.deepEqual(getPlayoffLayout(state.tournament, 1).nodes.map(({ left, top }) => [left, top]), before.nodes.map(({ left, top }) => [left, top]));
});

test('byes remain unscored, unseeded/reset brackets are empty, and invalid geometry fails explicitly', () => {
  const initial = fixture(3, false);
  assert.equal(getPlayoffLayout(initial.tournament, 1).nodes.length, 0);
  const state = fixture(3);
  const bye = state.tournament.playoffs.find((match) => match.bye);
  assert.ok(bye);
  assert.equal(bye.gameId, null);
  assert.equal(playoffPlaceholder(state.tournament, bye, bye.teamA ? 'B' : 'A'), 'Bye');
  const reset = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: state.tournament.id });
  const empty = getPlayoffLayout(reset.tournament, 1);
  assert.equal(empty.width, 0);
  assert.equal(empty.height, 0);
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.lines, []);
  for (const scale of [0, -1, NaN, Infinity]) assert.throws(() => getPlayoffLayout(state.tournament, scale), /font scale/);
  assert.throws(() => getPlayoffLayout({ ...state.tournament, playoffs: [{ ...state.tournament.playoffs[0], fromA: 'missing' }] }, 1), /connection/);
});
