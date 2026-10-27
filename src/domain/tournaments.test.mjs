import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addGuestPlayer, addPlayer, createGroup, getStandings, recordResult, startGame, ValidationError } from './groups.ts';
import {
  canScoreTournamentMatch, changeTournament, comparePoolStandings, createRotatingTournament, createTournament, currentPoolRound, getPoolStandings, getRankedPoolStandings, getTournamentPlacements, isCurrentPlayerMatch,
  currentMatchGame, getRotatingStandings, matchGameIds, matchGames, matchGameWins, matchWinner, parseTournament, startPlayoffs, tournamentCompletedAt, tournamentMatchStatus, tournamentPhase, tournamentPlayerIds, validateTournamentScore,
} from './tournaments.ts';
import { anonymizeParticipant } from './accountDeletion.ts';
import { DEFAULT_TOURNAMENT_SCORING, parseTournamentGameScoring, parseTournamentScoring, targetScore } from './tournamentScoring.ts';

const tournamentId = 'dddddddd-dddd-4ddd-8ddd-000000000001';

function scoreCurrent(state, match, a, b) {
  return changeTournament(state.group, state.tournament, {
    type: 'score', id: state.tournament.id, matchId: match.id,
    gameId: currentMatchGame(state.group, match).id, scoreA: String(a), scoreB: String(b),
  });
}

function championship(scoring = { ...DEFAULT_TOURNAMENT_SCORING, championship: 'best-of-3-11' }) {
  const { group, pairs } = fixture(2);
  let state = createTournament(group, tournamentId, 'Configured cup', pairs, scoring);
  state = scoreCurrent(state, state.tournament.pool[0], scoring.pool, 7);
  return startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map(row => row.teamId));
}

test('all stage score choices finish fixed-team brackets with byes and count each played game only once', () => {
  for (const count of [2, 3, 8]) for (const pool of [11, 15]) for (const playoff of [11, 15]) {
    for (const championship of ['single-11', 'single-15', 'best-of-3-11']) {
      const { group, pairs } = fixture(count), scoring = { pool, playoff, championship };
      let state = createTournament(group, tournamentId, 'Configured cup', pairs, scoring);
      for (const match of state.tournament.pool) state = scoreCurrent(state, match, pool, 7);
      state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map(row => row.teamId));
      let played = 0;
      while (tournamentPhase(state.group, state.tournament) !== 'completed') {
        const match = state.tournament.playoffs.find(match => canScoreTournamentMatch(state.group, state.tournament, match));
        assert.ok(match);
        state = scoreCurrent(state, match, targetScore(match.stage, scoring), 7);
        assert.deepEqual(parseTournament(JSON.parse(JSON.stringify(state.tournament)), state.group), state.tournament);
        assert.ok(++played <= count);
      }
      assert.equal(played, count - 1 + (championship === 'best-of-3-11' ? 1 : 0));
      assert.ok(state.group.games.every(game => game.status === 'completed' && game.wagerUnits === 0));
      assert.equal(getStandings(state.group).reduce((sum, row) => sum + row.wins, 0), state.group.games.length * 2);
      assert.equal(getStandings(state.group).reduce((sum, row) => sum + row.pointDifferential, 0), 0);
    }
  }
});

test('best-of-three stays playable at 1-0 and 1-1, completes at 2-1, and contributes separate results and timestamps', () => {
  let state = championship(), final = state.tournament.playoffs.at(-1);
  const baseline = getStandings(state.group);
  const firstId = currentMatchGame(state.group, final).id;
  assert.throws(() => changeTournament(state.group, state.tournament,
    { type: 'score', id: tournamentId, matchId: final.id, scoreA: '11', scoreB: '7' }), /moved to another game/);
  state = scoreCurrent(state, final, 9, 11); final = state.tournament.playoffs.at(-1);
  assert.equal(tournamentPhase(state.group, state.tournament), 'playoffs');
  assert.equal(tournamentMatchStatus(state.group, state.tournament, final), 'ready');
  assert.deepEqual(matchGameWins(state.group, final), { a: 0, b: 1 });
  assert.ok(isCurrentPlayerMatch(state.group, state.tournament, final, currentMatchGame(state.group, final).teamA[0]));
  assert.equal(getTournamentPlacements(state.group, state.tournament), null);
  assert.throws(() => changeTournament(state.group, state.tournament,
    { type: 'score', id: tournamentId, matchId: final.id, gameId: firstId, scoreA: '11', scoreB: '7' }), /moved to another game/);
  state = scoreCurrent(state, final, 11, 8); final = state.tournament.playoffs.at(-1);
  assert.deepEqual(matchGameWins(state.group, final), { a: 1, b: 1 });
  assert.equal(matchGames(state.group, final).length, 3);
  state = scoreCurrent(state, final, 12, 10); final = state.tournament.playoffs.at(-1);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, final), 'completed');
  assert.equal(matchWinner(state.group, final), final.teamA);
  assert.equal(getTournamentPlacements(state.group, state.tournament).first, final.teamA);
  const last = currentMatchGame(state.group, final);
  for (const playerId of last.teamA) {
    const before = baseline.find(row => row.player.id === playerId), after = getStandings(state.group).find(row => row.player.id === playerId);
    assert.equal(after.wins - before.wins, 2); assert.equal(after.losses - before.losses, 1);
    assert.equal(after.pointDifferential - before.pointDifferential, 3); assert.equal(after.netUnits, 0);
  }
  assert.throws(() => scoreCurrent(state, final, 11, 0), ValidationError);
  const completedAt = '2026-10-27T23:00:00.000Z';
  const stamped = { ...state.group, games: state.group.games.map(game => game.id === last.id ? { ...game, completedAt } : game) };
  assert.equal(tournamentCompletedAt(stamped, state.tournament), completedAt);
  const anonymous = anonymizeParticipant(stamped, [state.tournament], last.teamA[0], 'ffffffff-ffff-4fff-8fff-000000000099');
  parseTournament(anonymous.tournaments[0], anonymous.group);
  assert.equal(matchWinner(anonymous.group, anonymous.tournaments[0].playoffs.at(-1)), final.teamA);
});

test('a 2-0 series allocates no third game and clearing partial or finished series recalculates every result without reusing IDs', () => {
  for (const completedGames of [1, 2, 3]) {
    let state = championship(), final = state.tournament.playoffs.at(-1);
    const baseline = getStandings(state.group), pool = state.group.games.slice();
    for (let index = 0; index < completedGames; index++) {
      state = scoreCurrent(state, final, completedGames === 3 && index === 1 ? 7 : 11, completedGames === 3 && index === 1 ? 11 : 7);
      final = state.tournament.playoffs.at(-1);
    }
    if (completedGames === 2) assert.equal(final.gameIds.length, 2);
    const ids = matchGameIds(final), counter = state.group.nextGameNumber;
    const reset = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: final.id });
    const resetFinal = reset.tournament.playoffs.at(-1);
    assert.deepEqual(resetFinal.gameIds, [ids[0]]);
    assert.equal(currentMatchGame(reset.group, resetFinal).status, 'pending');
    assert.deepEqual(getStandings(reset.group), baseline);
    assert.deepEqual(reset.group.games.filter(game => game.tournament.stage === 'pool'), pool.filter(game => game.tournament.stage === 'pool'));
    assert.equal(reset.group.nextGameNumber, counter);
    assert.equal(reset.tournament.completedAt, null);
    parseTournament(reset.tournament, reset.group);
    const again = scoreCurrent(reset, resetFinal, 11, 7);
    assert.ok(!ids.includes(currentMatchGame(again.group, again.tournament.playoffs.at(-1)).id));
    const cleared = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
    assert.deepEqual(getStandings(cleared.group), baseline);
    assert.ok(cleared.group.games.every(game => game.tournament.stage === 'pool'));
  }
});

test('configured targets enforce first legal wins, malformed formats and series metadata fail, and legacy tournaments keep original rules', () => {
  for (const stage of ['pool', 'playoff', 'championship']) for (const target of [11, 15]) {
    const scoring = { pool: target, playoff: target, championship: `single-${target}` };
    for (const [a, b] of [[target, 0], [target, target - 2], [target + 1, target - 1], [51, 49]]) {
      validateTournamentScore(stage, String(a), String(b), scoring);
      validateTournamentScore(stage, String(b), String(a), scoring);
    }
    for (const [a, b] of [[target - 1, 0], [target, target - 1], [target + 1, target - 2], [3, 3]]) {
      assert.throws(() => validateTournamentScore(stage, String(a), String(b), scoring), ValidationError);
    }
  }
  for (const invalid of [null, [], 11, {}, { ...DEFAULT_TOURNAMENT_SCORING, pool: 'best-of-3-11' },
    { ...DEFAULT_TOURNAMENT_SCORING, playoff: '15' }, { ...DEFAULT_TOURNAMENT_SCORING, championship: 'best-of-3-15' }]) {
    assert.throws(() => parseTournamentScoring(invalid), ValidationError);
  }
  for (const tag of [
    { stage: 'pool', targetScore: 11, gameNumber: 1 }, { stage: 'championship', targetScore: 15, gameNumber: 2 },
    { stage: 'championship', targetScore: 11, gameNumber: 4 }, { stage: 'championship', gameNumber: 1 },
  ]) assert.throws(() => parseTournamentGameScoring(tag), ValidationError);
  let state = championship({ ...DEFAULT_TOURNAMENT_SCORING });
  const legacy = structuredClone(state.tournament); delete legacy.scoring;
  const legacyGroup = { ...state.group, games: state.group.games.map(game => {
    const tournament = { ...game.tournament }; delete tournament.targetScore;
    return { ...game, tournament };
  }) };
  assert.deepEqual(parseTournament(legacy, legacyGroup), legacy);
  assert.throws(() => scoreCurrent({ group: legacyGroup, tournament: legacy }, legacy.playoffs[0], 11, 7), ValidationError);
  state = scoreCurrent({ group: legacyGroup, tournament: legacy }, legacy.playoffs[0], 15, 7);
  assert.equal(tournamentPhase(state.group, state.tournament), 'completed');
});

test('saved series reject duplicate, missing, reordered, extra and premature-completion game links', () => {
  let state = championship(), final = state.tournament.playoffs.at(-1);
  state = scoreCurrent(state, final, 11, 7); final = state.tournament.playoffs.at(-1);
  const tamper = next => ({ ...state.tournament, playoffs: state.tournament.playoffs.map(match => match.id === final.id ? { ...match, ...next } : match) });
  for (const next of [
    { gameIds: [] }, { gameIds: [final.gameId, final.gameId] }, { gameIds: [...final.gameIds].reverse() },
    { gameIds: undefined }, { gameIds: [final.gameId, 'missing'] }, { gameIds: [final.gameId] },
  ]) assert.throws(() => parseTournament(tamper(next), state.group), ValidationError);
  assert.throws(() => parseTournament({ ...state.tournament, scoring: DEFAULT_TOURNAMENT_SCORING }, state.group), ValidationError);
  const invalidGame = { ...state.group, games: state.group.games.map(game => game.id === final.gameId
    ? { ...game, tournament: { ...game.tournament, gameNumber: 2 } } : game) };
  assert.throws(() => parseTournament(state.tournament, invalidGame), ValidationError);
  const wrongStage = { ...state.tournament, pool: state.tournament.pool.map(match => ({ ...match, gameIds: [match.gameId] })) };
  assert.throws(() => parseTournament(wrongStage, state.group), ValidationError);
});

test('rotating partners accept only single games to 11 or 15 and retain their round and individual-rank rules', () => {
  for (const target of [11, 15]) {
    const { group } = fixture(2), before = JSON.stringify(group);
    let state = createRotatingTournament(group, tournamentId, 'Rotating targets', group.players.map(player => player.id),
      { ...DEFAULT_TOURNAMENT_SCORING, pool: target });
    assert.equal(JSON.stringify(group), before);
    for (const match of state.tournament.pool) state = scoreCurrent(state, match, target, 7);
    assert.equal(tournamentPhase(state.group, state.tournament), 'completed');
    assert.equal(state.group.games.length, 3);
    assert.ok(state.group.games.every(game => game.tournament.targetScore === target && game.tournament.gameNumber === undefined));
    assert.ok(getRotatingStandings(state.group, state.tournament).every(row => row.wins + row.losses === 3));
    parseTournament(state.tournament, state.group);
    assert.throws(() => createRotatingTournament(group, tournamentId, 'Invalid series', group.players.map(player => player.id),
      { ...DEFAULT_TOURNAMENT_SCORING, pool: 'best-of-3-11' }), ValidationError);
  }
});

test('rotating schedules use every partnership once, every opponent twice and every player once per round', () => {
  for (const count of [4, 8]) {
    const { group } = fixture(count / 2);
    const before = JSON.stringify(group);
    const ids = group.players.map(player => player.id);
    const state = createRotatingTournament(group, tournamentId, ' Rotating cup ', ids);
    assert.equal(JSON.stringify(group), before);
    assert.equal(state.tournament.name, 'Rotating cup');
    assert.equal(state.tournament.pool.length, count * (count - 1) / 4);
    assert.equal(state.tournament.teams.length, count * (count - 1) / 2);
    assert.deepEqual(tournamentPlayerIds(state.tournament), ids);
    assert.deepEqual(state.tournament.playoffs, []);
    assert.deepEqual(state.tournament.seeds, []);
    const partners = new Map(), opponents = new Map(), rounds = new Map();
    const increment = (map, a, b) => { const key = [a, b].sort().join('|'); map.set(key, (map.get(key) ?? 0) + 1); };
    for (const match of state.tournament.pool) {
      const game = state.group.games.find(game => game.id === match.gameId);
      assert.equal(game.status, 'pending');
      assert.equal(game.wagerUnits, 0);
      const playing = [...game.teamA, ...game.teamB];
      assert.equal(new Set(playing).size, 4);
      const round = rounds.get(match.round) ?? new Set();
      for (const id of playing) { assert.ok(!round.has(id)); round.add(id); }
      rounds.set(match.round, round);
      increment(partners, ...game.teamA); increment(partners, ...game.teamB);
      for (const a of game.teamA) for (const b of game.teamB) increment(opponents, a, b);
    }
    assert.equal(rounds.size, count - 1);
    assert.ok([...rounds.values()].every(round => round.size === count));
    assert.equal(partners.size, count * (count - 1) / 2);
    assert.ok([...partners.values()].every(value => value === 1));
    assert.equal(opponents.size, partners.size);
    assert.ok([...opponents.values()].every(value => value === 2));
    assert.ok(getRotatingStandings(state.group, state.tournament).every(row => row.rank === null && row.netUnits === 0));
    assert.deepEqual(parseTournament(JSON.parse(JSON.stringify(state.tournament)), state.group), state.tournament);
  }
});

test('rotating creation rejects unsupported sizes, duplicate, deleted and out-of-group players without mutation', () => {
  const { group } = fixture(5);
  const ids = group.players.map(player => player.id);
  const before = JSON.stringify(group);
  for (const count of [0, 1, 2, 3, 5, 6, 7, 9, 10]) {
    assert.throws(() => createRotatingTournament(group, tournamentId, 'Cup', ids.slice(0, count)), ValidationError);
  }
  for (const selected of [
    [ids[0], ids[0].toUpperCase(), ids[2], ids[3]],
    [ids[0], ids[1], ids[2], 'bad-id'],
    [ids[0], ids[1], ids[2], 'ffffffff-ffff-4fff-8fff-000000000001'],
  ]) assert.throws(() => createRotatingTournament(group, tournamentId, 'Cup', selected), ValidationError);
  assert.throws(() => createRotatingTournament(group, tournamentId, ' ', ids.slice(0, 4)), ValidationError);
  const deleted = { ...group, players: group.players.map((player, i) => i === 0 ? { ...player, isDeleted: true } : player) };
  assert.throws(() => createRotatingTournament(deleted, tournamentId, 'Cup', ids.slice(0, 4)), ValidationError);
  assert.equal(JSON.stringify(group), before);
});

test('rotating rankings are tournament-only individual wins then differential, with shared ranks and no playoffs', () => {
  const { group, pairs } = fixture(3);
  const casual = startGame(group, pairs[0], pairs[1], '5');
  const prior = recordResult(casual, casual.games[0].id, '90', '0');
  let state = createRotatingTournament(prior, tournamentId, 'Cup', prior.players.slice(0, 4).map(p => p.id));
  for (const [index, match] of state.tournament.pool.entries()) {
    state = score(state, match, ...(index === 2 ? [7, 11] : [11, 7]));
    assert.equal(tournamentPhase(state.group, state.tournament), index === 2 ? 'completed' : 'pool');
  }
  const rows = getRotatingStandings(state.group, state.tournament);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 1, 4]);
  assert.deepEqual(rows.map(row => row.wins), [2, 2, 2, 0]);
  assert.deepEqual(rows.map(row => row.pointDifferential), [4, 4, 4, -12]);
  assert.ok(rows.every(row => row.wins + row.losses === 3 && row.netUnits === 0));
  assert.ok(getStandings(state.group).some(row => row.netUnits !== 0));
  assert.throws(() => startPlayoffs(state.group, state.tournament, []), ValidationError);
  assert.throws(() => changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId }), ValidationError);
  assert.throws(() => getPoolStandings(state.group, state.tournament), ValidationError);
  assert.throws(() => getTournamentPlacements(state.group, state.tournament), ValidationError);
  const other = createRotatingTournament(state.group, 'dddddddd-dddd-4ddd-8ddd-000000000002', 'Other cup', prior.players.slice(2, 6).map(p => p.id));
  assert.deepEqual(getRotatingStandings(other.group, state.tournament), rows);
  const first = state.tournament.pool[0];
  const reset = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: first.id });
  assert.equal(tournamentPhase(reset.group, reset.tournament), 'pool');
  assert.equal(reset.group.games.find(game => game.id === first.gameId).status, 'pending');
  assert.deepEqual(reset.group.games.filter(game => game.id !== first.gameId), state.group.games.filter(game => game.id !== first.gameId));
  assert.equal(reset.group.nextGameNumber, state.group.nextGameNumber);
  assert.equal(reset.tournament.completedAt, null);
  assert.deepEqual(getRotatingStandings(score(reset, first, 11, 7).group, reset.tournament), rows);
});

test('rotating scoring, timestamps and historical deleted/guest participants stay safe in all currencies', () => {
  for (const currency of ['none', 'money', 'boba']) {
    const base = fixture(2);
    const group = { ...base.group, currency, players: base.group.players.map((p, i) => i === 1 ? { ...p, isGuest: true } : p) };
    let state = createRotatingTournament(group, tournamentId, 'Cup', group.players.map(p => p.id));
    assert.throws(() => score(state, state.tournament.pool[0], 11, 10), ValidationError);
    assert.throws(() => score(state, state.tournament.pool[0], Number.MAX_SAFE_INTEGER + 1, 0), ValidationError);
    for (const match of state.tournament.pool) state = score(state, match, 11, 7);
    const first = state.tournament.pool[0];
    const earliest = '2026-10-23T12:00:00.000Z', latest = '2026-10-23T12:10:00.000Z';
    const stamped = { ...state.group, games: state.group.games.map(game => ({ ...game,
      createdAt: earliest, completedAt: game.id === first.gameId ? latest : earliest })) };
    assert.equal(tournamentCompletedAt(stamped, state.tournament), latest);
    assert.equal(tournamentCompletedAt({ ...stamped, games: stamped.games.map((game, i) => i ? game : { ...game, completedAt: null }) }, state.tournament), null);
    const reset = changeTournament(stamped, state.tournament, { type: 'reset-result', id: tournamentId, matchId: first.id });
    assert.equal(tournamentCompletedAt(reset.group, reset.tournament), null);
    const anonymized = anonymizeParticipant(reset.group, [reset.tournament], group.players[0].id, 'ffffffff-ffff-4fff-8fff-000000000001');
    const finished = score({ group: anonymized.group, tournament: anonymized.tournaments[0] }, first, 11, 7);
    assert.equal(tournamentPhase(finished.group, finished.tournament), 'completed');
    assert.ok(getRotatingStandings(finished.group, finished.tournament).some(row => row.player.isDeleted));
    assert.ok(getRotatingStandings(finished.group, finished.tournament).some(row => row.player.isGuest));
    assert.ok(getRotatingStandings(finished.group, finished.tournament).every(row => row.netUnits === 0));
    parseTournament(finished.tournament, finished.group);
  }
});

test('rotating persisted data rejects incomplete or repeated partnerships, overlapping rounds and playoff fields', () => {
  const { group } = fixture(4);
  const state = createRotatingTournament(group, tournamentId, 'Cup', group.players.map(p => p.id));
  const t = state.tournament;
  for (const malformed of [
    { ...t, teams: t.teams.slice(1) },
    { ...t, teams: t.teams.map((team, i) => i === 1 ? { ...team, players: t.teams[0].players } : team) },
    { ...t, pool: t.pool.slice(1) },
    { ...t, pool: t.pool.map((match, i) => i === 2 ? { ...match, round: 1 } : match) },
    { ...t, pool: t.pool.map((match, i) => i === 2 ? { ...match, teamA: t.pool[0].teamA } : match) },
    { ...t, playoffs: [t.pool[0]] }, { ...t, seeds: [t.teams[0].id] },
  ]) assert.throws(() => parseTournament(malformed, state.group), ValidationError);
  assert.throws(() => parseTournament(t, { ...state.group, games: state.group.games.map((game, i) => i === 0 ? { ...game, wagerUnits: 1 } : game) }), ValidationError);
});

test('all currencies keep tournaments wager-free through completion and resets', () => {
  for (const currency of ['none', 'money', 'boba']) {
    const base = fixture(2);
    let state = finishPool(createTournament({ ...base.group, currency, avatar: 'island' }, tournamentId, 'Currency cup', base.pairs));
    const poolRows = getStandings(state.group);
    state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
    state = finishPlayoffs(state);
    assert.ok(state.group.games.every((game) => game.wagerUnits === 0));
    assert.ok(getStandings(state.group).every((row) => row.netUnits === 0));
    assert.equal(state.group.currency, currency);
    assert.equal(state.group.avatar, 'island');
    state = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
    assert.deepEqual(getStandings(state.group), poolRows);
    state = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: state.tournament.pool[0].id });
    assert.ok(getStandings(state.group).every((row) => row.rank === null && row.netUnits === 0));
    const invalid = { ...state.group, games: state.group.games.map((game) => ({ ...game, wagerUnits: 1 })) };
    assert.throws(() => parseTournament(state.tournament, invalid), ValidationError);
    assert.throws(() => getStandings(invalid), ValidationError);
  }
});

function fixture(count) {
  let group = { ...createGroup([], 'Synthetic tournament group', 'money'), id: 'cccccccc-cccc-4ccc-8ccc-000000000001' };
  for (let index = 1; index <= count * 2; index++) {
    group = addPlayer(group, { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, name: `Player ${index}` });
  }
  const pairs = Array.from({ length: count }, (_, index) => group.players.slice(index * 2, index * 2 + 2).map((player) => player.id));
  return { group, pairs };
}
function create(count) {
  const { group, pairs } = fixture(count);
  return createTournament(group, tournamentId, 'Round robin', pairs);
}
function score(state, match, a, b) {
  return changeTournament(state.group, state.tournament, { type: 'score', id: tournamentId, matchId: match.id, scoreA: String(a), scoreB: String(b) });
}
function finishPool(state, scores) {
  for (const match of state.tournament.pool) {
    const a = Number(match.teamA.split('-')[1]);
    const b = Number(match.teamB.split('-')[1]);
    const result = scores ? scores(a, b) : a < b ? [11, 7] : [7, 11];
    state = score(state, match, ...result);
  }
  return state;
}
function finishPlayoffs(state) {
  for (let step = 0; tournamentPhase(state.group, state.tournament) !== 'completed'; step++) {
    assert.ok(step < 8);
    const match = state.tournament.playoffs.find((match) => state.group.games.find((game) => game.id === match.gameId)?.status === 'pending');
    assert.ok(match);
    state = score(state, match, ...(Number(match.teamA.split('-')[1]) < Number(match.teamB.split('-')[1]) ? [15, 9] : [9, 15]));
    parseTournament(state.tournament, state.group);
  }
  return state;
}

test('all fixed and rotating formats unlock whole pool rounds in order, not individual games', () => {
  const states = Array.from({ length: 7 }, (_, index) => create(index + 2));
  for (const count of [4, 8]) {
    const { group } = fixture(count / 2);
    states.push(createRotatingTournament(group, tournamentId, 'Rotation', group.players.map(player => player.id)));
  }
  for (let state of states) {
    const rounds = [...new Set(state.tournament.pool.map(match => match.round))].sort((a, b) => a - b);
    for (const round of rounds) {
      assert.equal(currentPoolRound(state.group, state.tournament), round);
      const matches = state.tournament.pool.filter(match => match.round === round).reverse();
      for (const match of matches) {
        const before = JSON.stringify(state);
        for (const future of state.tournament.pool.filter(entry => entry.round > round)) {
          assert.equal(canScoreTournamentMatch(state.group, state.tournament, future), false);
          assert.equal(tournamentMatchStatus(state.group, state.tournament, future), 'waiting');
          assert.throws(() => score(state, future, 11, 7), new RegExp(`pool round ${round}`));
          assert.equal(JSON.stringify(state), before);
          for (const player of state.group.players) assert.equal(isCurrentPlayerMatch(state.group, state.tournament, future, player.id), false);
        }
        assert.equal(currentPoolRound(state.group, state.tournament), round);
        assert.equal(canScoreTournamentMatch(state.group, state.tournament, match), true);
        assert.equal(tournamentMatchStatus(state.group, state.tournament, match), 'ready');
        const game = state.group.games.find(entry => entry.id === match.gameId);
        for (const player of state.group.players) {
          assert.equal(isCurrentPlayerMatch(state.group, state.tournament, match, player.id), [...game.teamA, ...game.teamB].includes(player.id));
        }
        assert.equal(isCurrentPlayerMatch(state.group, state.tournament, match, 'not-a-participant'), false);
        state = score(state, match, 11, 7);
        assert.equal(canScoreTournamentMatch(state.group, state.tournament, match), false);
        assert.equal(tournamentMatchStatus(state.group, state.tournament, match), 'completed');
        assert.equal(isCurrentPlayerMatch(state.group, state.tournament, match, game.teamA[0]), false);
      }
      parseTournament(state.tournament, state.group);
    }
    assert.equal(currentPoolRound(state.group, state.tournament), null);
  }
});

test('clearing an early pool result preserves later results and blocks new scores until repaired', () => {
  const base = fixture(4);
  for (let state of [create(4), createRotatingTournament(base.group, tournamentId, 'Rotation', base.group.players.map(player => player.id))]) {
    for (const match of state.tournament.pool.filter(match => match.round <= 2)) state = score(state, match, 11, 7);
    const first = state.tournament.pool[0];
    const laterGames = state.group.games.filter(game => state.tournament.pool.some(match => match.round === 2 && match.gameId === game.id));
    state = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: first.id });
    assert.equal(currentPoolRound(state.group, state.tournament), 1);
    assert.deepEqual(state.group.games.filter(game => laterGames.some(later => later.id === game.id)), laterGames);
    const future = state.tournament.pool.find(match => match.round === 3);
    assert.equal(tournamentMatchStatus(state.group, state.tournament, first), 'ready');
    assert.equal(tournamentMatchStatus(state.group, state.tournament, future), 'waiting');
    for (const match of state.tournament.pool.filter(match => match.round === 2)) {
      assert.equal(tournamentMatchStatus(state.group, state.tournament, match), 'completed');
    }
    assert.throws(() => score(state, future, 11, 7), /pool round 1/);
    assert.deepEqual(parseTournament(state.tournament, state.group), state.tournament);
    state = score(state, first, 11, 7);
    assert.equal(currentPoolRound(state.group, state.tournament), 3);
    assert.equal(canScoreTournamentMatch(state.group, state.tournament, future), true);
  }
});

test('historical out-of-order results remain readable without unlocking unfinished earlier rounds', () => {
  const state = create(4);
  const future = state.tournament.pool.find(match => match.round === 2);
  const historical = recordResult(state.group, future.gameId, '11', '7');
  assert.deepEqual(parseTournament(state.tournament, historical), state.tournament);
  assert.equal(currentPoolRound(historical, { ...state.tournament, pool: [...state.tournament.pool].reverse() }), 1);
  assert.equal(canScoreTournamentMatch(historical, state.tournament, future), false);
  assert.equal(tournamentMatchStatus(historical, state.tournament, future), 'completed');
  assert.equal(isCurrentPlayerMatch(historical, state.tournament, future, historical.games.find(game => game.id === future.gameId).teamA[0]), false);
});

test('personal playoff highlights follow playable matches and never highlight byes or completed games', () => {
  let state = finishPool(create(3));
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map(row => row.teamId));
  const bye = state.tournament.playoffs.find(match => match.bye);
  assert.ok(bye);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, bye), 'bye');
  assert.equal(tournamentMatchStatus(state.group, state.tournament, state.tournament.playoffs.at(-1)), 'waiting');
  for (const player of state.group.players) assert.equal(isCurrentPlayerMatch(state.group, state.tournament, bye, player.id), false);
  for (const match of state.tournament.playoffs.filter(match => !match.gameId)) assert.equal(canScoreTournamentMatch(state.group, state.tournament, match), false);
  const ready = state.tournament.playoffs.find(match => canScoreTournamentMatch(state.group, state.tournament, match));
  const game = state.group.games.find(game => game.id === ready.gameId);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, ready), 'ready');
  assert.equal(isCurrentPlayerMatch(state.group, state.tournament, ready, game.teamB[0]), true);
  state = score(state, ready, 15, 9);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, ready), 'completed');
  assert.equal(isCurrentPlayerMatch(state.group, state.tournament, ready, game.teamA[0]), false);
  const final = state.tournament.playoffs.at(-1);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, final), 'ready');
  assert.equal(isCurrentPlayerMatch(state.group, state.tournament, final, game.teamA[0]), true);
  assert.equal(isCurrentPlayerMatch(state.group, state.tournament, final, game.teamB[0]), false);
  state = score(state, final, 15, 9);
  assert.equal(tournamentMatchStatus(state.group, state.tournament, final), 'completed');
  for (const player of state.group.players) assert.equal(isCurrentPlayerMatch(state.group, state.tournament, final, player.id), false);
});

test('mixed and all-guest fixed teams complete pools and playoffs and retain standings on reset', () => {
  for (const guestsOnly of [false, true]) {
    const base = fixture(4);
    let group = { ...base.group, players: [] };
    for (const [index, player] of base.group.players.entries()) {
      group = guestsOnly || index % 2 === 0 ? addGuestPlayer(group, player.id, player.name) : addPlayer(group, player);
    }
    let state = finishPool(createTournament(group, tournamentId, 'Guest cup', base.pairs));
    const poolRows = getStandings(state.group);
    state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
    state = finishPlayoffs(state);
    assert.equal(tournamentPhase(state.group, state.tournament), 'completed');
    assert.equal(getStandings(state.group).filter((row) => row.player.isGuest).length, guestsOnly ? 8 : 4);
    assert.ok(getStandings(state.group).every((row) => row.wins + row.losses >= 3 && row.netUnits === 0));
    const reset = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
    assert.deepEqual(getStandings(reset.group), poolRows);
    assert.deepEqual(reset.group.players, group.players);
  }
});

test('timestamp metadata survives parsing and creation dates survive championship correction and resets', () => {
  let state = finishPool(create(2));
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
  state = finishPlayoffs(state);
  const createdAt = '2026-10-22T16:00:00.000Z';
  const completedAt = '2026-10-23T16:00:00.000Z';
  const group = { ...state.group, games: state.group.games.map((game) => ({ ...game, createdAt, completedAt })) };
  const tournament = { ...state.tournament, createdAt, completedAt };
  assert.deepEqual(parseTournament(tournament, group), tournament);
  const final = tournament.playoffs.at(-1);
  const cleared = changeTournament(group, tournament, { type: 'reset-result', id: tournamentId, matchId: final.id });
  const pending = cleared.group.games.find((game) => game.id === final.gameId);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.createdAt, createdAt);
  assert.equal(pending.completedAt, undefined);
  assert.equal(cleared.tournament.createdAt, createdAt);
  assert.equal(cleared.tournament.completedAt, null);
  assert.equal(tournamentPhase(cleared.group, cleared.tournament), 'playoffs');
  assert.deepEqual(parseTournament(cleared.tournament, cleared.group), cleared.tournament);
  assert.throws(() => parseTournament({ ...cleared.tournament, completedAt }, cleared.group), ValidationError);
  const reset = changeTournament(group, tournament, { type: 'reset-playoffs', id: tournamentId });
  assert.equal(reset.tournament.createdAt, createdAt);
  assert.equal(reset.tournament.completedAt, null);
  assert.equal(tournamentPhase(reset.group, reset.tournament), 'ready');
  assert.ok(reset.group.games.every((game) => game.createdAt === createdAt && game.completedAt === completedAt));
});

test('every supported size has each pool pairing exactly once and no team plays twice in a round', () => {
  for (let count = 2; count <= 8; count++) {
    const { group, pairs } = fixture(count);
    const before = JSON.stringify(group);
    const state = createTournament(group, tournamentId, '  Round robin  ', pairs);
    assert.equal(JSON.stringify(group), before);
    assert.equal(state.tournament.name, 'Round robin');
    assert.equal(state.tournament.pool.length, count * (count - 1) / 2);
    assert.equal(state.group.games.length, state.tournament.pool.length);
    const pairings = new Set();
    const rounds = new Map();
    for (const match of state.tournament.pool) {
      pairings.add([match.teamA, match.teamB].sort().join('|'));
      const used = rounds.get(match.round) ?? new Set();
      assert.ok(!used.has(match.teamA) && !used.has(match.teamB));
      used.add(match.teamA); used.add(match.teamB); rounds.set(match.round, used);
    }
    assert.equal(pairings.size, state.tournament.pool.length);
    assert.equal(rounds.size, count % 2 ? count : count - 1);
    assert.ok(state.group.games.every((game) => game.status === 'pending' && game.wagerUnits === 0 && game.tournament.id === tournamentId));
    assert.ok(getStandings(state.group).every((row) => row.rank === null));
    assert.deepEqual(parseTournament(JSON.parse(JSON.stringify(state.tournament)), state.group), state.tournament);
  }
});

test('fixed teams reject unsupported sizes, repeated players, outsiders and invalid names', () => {
  const { group, pairs } = fixture(9);
  for (const invalid of [[], pairs.slice(0, 1), pairs, [pairs[0], pairs[0]], [pairs[0], [pairs[1][0]]], [pairs[0], ['outsider', pairs[1][1]]]]) {
    assert.throws(() => createTournament(group, tournamentId, 'Test', invalid), ValidationError);
  }
  assert.throws(() => createTournament(group, tournamentId, ' ', pairs.slice(0, 2)), ValidationError);
  assert.throws(() => createTournament({ ...group, nextGameNumber: Number.MAX_SAFE_INTEGER }, tournamentId, 'Test', pairs.slice(0, 2)), ValidationError);
  assert.equal(group.games.length, 0);
});

test('pool and playoff scores stop at the first valid win with no cap', () => {
  for (const stage of ['pool', 'playoff', 'championship']) {
    const target = stage === 'pool' ? 11 : 15;
    for (const [a, b] of [[target, 0], [target, target - 2], [target + 1, target - 1], [target + 9, target + 7]]) {
      assert.doesNotThrow(() => validateTournamentScore(stage, String(a), String(b)));
      assert.doesNotThrow(() => validateTournamentScore(stage, String(b), String(a)));
    }
    for (const [a, b] of [[target - 1, 0], [target, target - 1], [target + 1, target - 2], [target, target]]) {
      assert.throws(() => validateTournamentScore(stage, String(a), String(b)), ValidationError);
    }
    for (const input of ['-1', '2.5', '1e2', '9007199254740992']) assert.throws(() => validateTournamentScore(stage, input, '0'), ValidationError);
  }
  assert.throws(() => validateTournamentScore('unknown', '15', '0'), ValidationError);
});

test('all teams advance, highest seeds get byes, and precisely N-1 playoff games determine the champion', () => {
  for (let count = 2; count <= 8; count++) {
    let state = create(count);
    assert.throws(() => startPlayoffs(state.group, state.tournament, state.tournament.teams.map((team) => team.id)), ValidationError);
    state = finishPool(state);
    const before = getStandings(state.group);
    const seeds = getPoolStandings(state.group, state.tournament).map((row) => row.teamId);
    state = startPlayoffs(state.group, state.tournament, seeds);
    assert.deepEqual(getStandings(state.group), before);
    const size = 2 ** Math.ceil(Math.log2(count));
    const byes = state.tournament.playoffs.filter((match) => match.bye);
    assert.deepEqual(new Set(byes.map((match) => matchWinner(state.group, match))), new Set(seeds.slice(0, size - count)));
    assert.ok(byes.every((match) => match.gameId === null));
    state = finishPlayoffs(state);
    assert.equal(matchWinner(state.group, state.tournament.playoffs.at(-1)), 'team-1');
    assert.equal(state.group.games.filter((game) => game.tournament.stage !== 'pool').length, count - 1);
    const rows = getStandings(state.group);
    assert.equal(rows.reduce((sum, row) => sum + row.wins, 0), 2 * (count * (count - 1) / 2 + count - 1));
    assert.ok(rows.every((row) => row.netUnits === 0));
  }
});

test('first and second place follow only the saved championship for every supported field size and reset', () => {
  for (let count = 2; count <= 8; count++) {
    let state = create(count);
    assert.equal(getTournamentPlacements(state.group, state.tournament), null);
    state = finishPool(state);
    assert.equal(getTournamentPlacements(state.group, state.tournament), null);
    state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
    assert.equal(getTournamentPlacements(state.group, state.tournament), null);
    state = finishPlayoffs(state);
    const final = state.tournament.playoffs.at(-1);
    const snapshot = JSON.stringify(state);
    const placements = getTournamentPlacements(state.group, state.tournament);
    assert.equal(placements.first, matchWinner(state.group, final));
    assert.equal(placements.second, final.teamA === placements.first ? final.teamB : final.teamA);
    assert.deepEqual(Object.keys(placements), ['first', 'second']);
    assert.equal(JSON.stringify(state), snapshot);
    for (const [a, b] of [[15, 9], [9, 15]]) {
      state = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: final.id });
      assert.equal(getTournamentPlacements(state.group, state.tournament), null);
      state = score(state, final, a, b);
      assert.deepEqual(getTournamentPlacements(state.group, state.tournament),
        { first: a > b ? final.teamA : final.teamB, second: a > b ? final.teamB : final.teamA });
    }
    state = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
    assert.equal(getTournamentPlacements(state.group, state.tournament), null);
  }
});

test('placements reject a completed bracket without a valid two-team championship', () => {
  let state = finishPool(create(2));
  state = finishPlayoffs(startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId)));
  const final = state.tournament.playoffs.at(-1);
  for (const invalid of [
    { ...final, bye: true }, { ...final, stage: 'pool' }, { ...final, teamB: null },
    { ...final, teamB: final.teamA }, { ...final, teamA: 'unknown-team' },
  ]) {
    assert.throws(() => getTournamentPlacements(state.group, { ...state.tournament, playoffs: [invalid] }), ValidationError);
  }
});

test('head-to-head precedes differential and exact multi-team ties require owner seed confirmation', () => {
  const outcomes = new Map([['1-2', [11, 9]], ['1-3', [11, 9]], ['1-4', [0, 11]], ['2-3', [11, 0]], ['2-4', [11, 0]], ['3-4', [11, 9]]]);
  const state = finishPool(create(4), (a, b) => a < b ? outcomes.get(`${a}-${b}`) : [...outcomes.get(`${b}-${a}`)].reverse());
  const rows = getPoolStandings(state.group, state.tournament);
  assert.deepEqual(rows.map((row) => row.teamId), ['team-1', 'team-2', 'team-3', 'team-4']);
  assert.ok(rows[0].pointDifferential < rows[1].pointDifferential);
  assert.throws(() => startPlayoffs(state.group, state.tournament, ['team-2', 'team-1', 'team-3', 'team-4']), ValidationError);

  const cycle = new Map([['1-2', [11, 7]], ['1-3', [5, 11]], ['2-3', [11, 9]]]);
  const tied = finishPool(create(3), (a, b) => a < b ? cycle.get(`${a}-${b}`) : [...cycle.get(`${b}-${a}`)].reverse());
  const tiedRows = getPoolStandings(tied.group, tied.tournament);
  assert.deepEqual(tiedRows.map((row) => row.headToHeadWins), [1, 1, 1]);
  assert.equal(comparePoolStandings(tiedRows[1], tiedRows[2]), 0);
  assert.throws(() => startPlayoffs(tied.group, tied.tournament, []), ValidationError);
  assert.throws(() => startPlayoffs(tied.group, tied.tournament, ['team-3', 'team-1', 'team-1']), ValidationError);
  const seeded = startPlayoffs(tied.group, tied.tournament, ['team-3', 'team-2', 'team-1']);
  assert.deepEqual(seeded.tournament.seeds, ['team-3', 'team-2', 'team-1']);
});

test('pool ranks use shared competition ranks without changing tie-breaks or owner-confirmed seeds', () => {
  let state = create(4);
  assert.deepEqual(getRankedPoolStandings(state.group, state.tournament).map((row) => row.rank), [1, 1, 1, 1]);
  for (const match of state.tournament.pool.filter(entry => entry.round === 1)) state = score(state, match, 11, 7);
  const snapshot = JSON.stringify(state);
  const rows = getRankedPoolStandings(state.group, state.tournament);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3, 3]);
  assert.deepEqual(rows.map(({ rank, ...row }) => row), getPoolStandings(state.group, state.tournament));
  assert.equal(JSON.stringify(state), snapshot);

  const cycle = new Map([['1-2', [11, 7]], ['1-3', [5, 11]], ['2-3', [11, 9]]]);
  const tied = finishPool(create(3), (a, b) => a < b ? cycle.get(`${a}-${b}`) : [...cycle.get(`${b}-${a}`)].reverse());
  const ranked = getRankedPoolStandings(tied.group, tied.tournament);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 2]);
  const seeded = startPlayoffs(tied.group, tied.tournament, ['team-3', 'team-2', 'team-1']);
  assert.deepEqual(getRankedPoolStandings(seeded.group, seeded.tournament), ranked);
  const finished = finishPlayoffs(seeded);
  assert.deepEqual(getRankedPoolStandings(finished.group, finished.tournament), ranked, 'Playoff results do not alter pool ranks.');
});

test('playoff reset removes only those results, allows pool correction and never reuses match IDs', () => {
  const base = fixture(3);
  let group = startGame(base.group, base.pairs[0], base.pairs[1], '5');
  group = recordResult(group, group.games[0].id, '1', '0');
  let state = finishPool(createTournament(group, tournamentId, 'Test', base.pairs));
  const poolStandings = getStandings(state.group);
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
  const originalIds = state.tournament.playoffs.map((match) => match.id);
  const ready = state.tournament.playoffs.find((match) => match.gameId);
  state = score(state, ready, 15, 9);
  for (const match of [state.tournament.pool[0], ready]) {
    assert.throws(() => changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: match.id }), ValidationError);
  }
  const counter = state.group.nextGameNumber;
  state = changeTournament(state.group, state.tournament, { type: 'reset-playoffs', id: tournamentId });
  assert.equal(state.group.nextGameNumber, counter);
  assert.deepEqual(getStandings(state.group), poolStandings);
  assert.equal(state.group.games[0].wagerUnits, 500);
  const poolMatch = state.tournament.pool[0];
  state = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: poolMatch.id });
  assert.equal(tournamentPhase(state.group, state.tournament), 'pool');
  state = score(state, poolMatch, 11, 7);
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
  assert.ok(state.tournament.playoffs.every((match) => !originalIds.includes(match.id)));
  parseTournament(state.tournament, state.group);
});

test('a final result can be cleared without changing earlier rounds, and unready/byes cannot be scored', () => {
  let state = finishPool(create(3));
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
  for (const match of state.tournament.playoffs.filter((match) => !match.gameId)) {
    assert.throws(() => score(state, match, 15, 0), ValidationError);
  }
  state = finishPlayoffs(state);
  const final = state.tournament.playoffs.at(-1);
  const before = state.group.games.filter((game) => game.id !== final.gameId);
  state = changeTournament(state.group, state.tournament, { type: 'reset-result', id: tournamentId, matchId: final.id });
  assert.equal(tournamentPhase(state.group, state.tournament), 'playoffs');
  assert.deepEqual(state.group.games.filter((game) => game.id !== final.gameId), before);
  parseTournament(state.tournament, state.group);
});

test('invalid persisted bracket shapes and unsafe group totals fail explicitly', () => {
  let state = finishPool(create(4));
  state = startPlayoffs(state.group, state.tournament, getPoolStandings(state.group, state.tournament).map((row) => row.teamId));
  assert.throws(() => parseTournament({ ...state.tournament, playoffs: state.tournament.playoffs.slice(1) }, state.group), ValidationError);
  assert.throws(() => parseTournament({ ...state.tournament, pool: [state.tournament.pool[0], ...state.tournament.pool.slice(0, -1)] }, state.group), ValidationError);
  const cyclic = state.tournament.playoffs.map((match, index, matches) => index === matches.length - 1 ? { ...match, fromA: match.id } : match);
  assert.throws(() => parseTournament({ ...state.tournament, playoffs: cyclic }, state.group), ValidationError);
  const base = fixture(2);
  let group = startGame(base.group, base.pairs[0], base.pairs[1], '0');
  group = recordResult(group, group.games[0].id, String(Number.MAX_SAFE_INTEGER), '0');
  const pending = createTournament(group, tournamentId, 'Too many points', base.pairs);
  assert.throws(() => score(pending, pending.tournament.pool[0], 11, 7), ValidationError);
  assert.equal(pending.group.games.at(-1).status, 'pending');
});
