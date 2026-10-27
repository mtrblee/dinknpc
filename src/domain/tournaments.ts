import { allocateDoublesGame, getStandings, recordResult, validatePlayerId, ValidationError } from './groups.ts';
import type { Game, Group, Standing, Team } from '../types/groups.ts';
import type { PoolStanding, RankedPoolStanding, Tournament, TournamentAction, TournamentMatch, TournamentScoring, TournamentTeam } from '../types/tournaments.ts';
import { parseActivityTimestamps } from './timestamps.ts';
import { rotatingRounds } from './rotatingSchedule.ts';
import { parseTournamentGameScoring, parseTournamentScoring, targetScore, validateTournamentScore } from './tournamentScoring.ts';
export { targetScore, validateTournamentScore } from './tournamentScoring.ts';

export const MAX_TOURNAMENT_TEAMS = 8;

export function requireTeam(tournament: Tournament, id: string): TournamentTeam {
  const team = tournament.teams.find((entry) => entry.id === id);
  if (!team) throw new ValidationError('Tournament references an unknown team.');
  return team;
}
export function matchGameIds(match: TournamentMatch): readonly string[] {
  return match.gameIds ?? (match.gameId ? [match.gameId] : []);
}
export function matchGames(group: Group, match: TournamentMatch): readonly Game[] {
  return matchGameIds(match).map(id => {
    const game = group.games.find(entry => entry.id === id);
    if (!game) throw new ValidationError('Tournament match references a missing game.');
    return game;
  });
}
export function currentMatchGame(group: Group, match: TournamentMatch): Game | undefined {
  const games = matchGames(group, match);
  return games.find(game => game.status === 'pending') ?? games[games.length - 1];
}
export function matchGameWins(group: Group, match: TournamentMatch): { a: number; b: number } {
  let a = 0, b = 0;
  for (const game of matchGames(group, match)) {
    if (game.status === 'completed') {
      if (game.scoreA > game.scoreB) a++;
      else b++;
    }
  }
  return { a, b };
}
export function matchWinner(group: Group, match: TournamentMatch): string | null {
  if (match.bye) return match.teamA ?? match.teamB;
  const wins = matchGameWins(group, match), required = match.gameIds ? 2 : 1;
  return wins.a >= required ? match.teamA : wins.b >= required ? match.teamB : null;
}
export function currentPoolRound(group: Group, tournament: Tournament): number | null {
  let round: number | null = null;
  for (const match of tournament.pool) {
    if (!matchWinner(group, match)) round = round === null ? match.round : Math.min(round, match.round);
  }
  return round;
}
export function canScoreTournamentMatch(group: Group, tournament: Tournament, match: TournamentMatch): boolean {
  if (match.bye || !match.teamA || !match.teamB) return false;
  const game = currentMatchGame(group, match);
  return game?.status === 'pending' && (match.stage !== 'pool' || match.round === currentPoolRound(group, tournament));
}
export function tournamentMatchStatus(
  group: Group, tournament: Tournament, match: TournamentMatch,
): 'ready' | 'waiting' | 'completed' | 'bye' {
  if (match.bye) return 'bye';
  if (matchWinner(group, match)) return 'completed';
  return canScoreTournamentMatch(group, tournament, match) ? 'ready' : 'waiting';
}
export function isCurrentPlayerMatch(group: Group, tournament: Tournament, match: TournamentMatch, playerId: string): boolean {
  if (!canScoreTournamentMatch(group, tournament, match)) return false;
  return [match.teamA, match.teamB].some((id) => id !== null && requireTeam(tournament, id).players.includes(playerId));
}
export function tournamentPhase(group: Group, tournament: Tournament): 'pool' | 'ready' | 'playoffs' | 'completed' {
  if (tournament.style === 'rotating-partner-round-robin') {
    return tournament.pool.every((match) => matchWinner(group, match)) ? 'completed' : 'pool';
  }
  if (tournament.playoffs.length) {
    return matchWinner(group, tournament.playoffs[tournament.playoffs.length - 1]) ? 'completed' : 'playoffs';
  }
  return tournament.pool.every((match) => matchWinner(group, match)) ? 'ready' : 'pool';
}
export function getTournamentPlacements(group: Group, tournament: Tournament): { readonly first: string; readonly second: string } | null {
  if (tournament.style !== 'fixed-round-robin') throw new ValidationError('Rotating tournaments use individual standings, not fixed-team placements.');
  const final = tournament.playoffs[tournament.playoffs.length - 1];
  if (!final) return null;
  const first = matchWinner(group, final);
  if (!first) return null;
  if (final.stage !== 'championship' || final.bye || !final.teamA || !final.teamB || final.teamA === final.teamB) {
    throw new ValidationError('Tournament placements require a played championship between two distinct teams.');
  }
  const second = first === final.teamA ? final.teamB : final.teamA;
  requireTeam(tournament, first);
  requireTeam(tournament, second);
  return { first, second };
}
export function tournamentPlayerIds(tournament: Tournament): readonly string[] {
  return [...new Set(tournament.teams.flatMap((team) => team.players))];
}
export function getRotatingStandings(group: Group, tournament: Tournament): readonly Standing[] {
  if (tournament.style !== 'rotating-partner-round-robin') throw new ValidationError('This tournament uses fixed-team standings.');
  const participants = new Set(tournamentPlayerIds(tournament));
  if ([...participants].some((id) => !group.players.some((player) => player.id === id))) {
    throw new ValidationError('Tournament references an unknown player.');
  }
  const gameIds = new Set(tournament.pool.map((match) => match.gameId));
  return getStandings({ ...group, players: group.players.filter((player) => participants.has(player.id)),
    games: group.games.filter((game) => gameIds.has(game.id)) });
}
export function tournamentCompletedAt(group: Group, tournament: Tournament): string | null {
  if (tournamentPhase(group, tournament) !== 'completed') return null;
  const matches = tournament.style === 'rotating-partner-round-robin' ? tournament.pool : tournament.playoffs.slice(-1);
  let latest: string | null = null;
  for (const match of matches) {
    const game = currentMatchGame(group, match);
    if (!game || game.status !== 'completed') throw new ValidationError('A completed tournament is missing a completed game.');
    const completedAt = parseActivityTimestamps(game, true).completedAt;
    if (!completedAt) return null;
    if (!latest || completedAt > latest) latest = completedAt;
  }
  return latest;
}
export function comparePoolStandings(left: PoolStanding, right: PoolStanding): number {
  return right.wins - left.wins || right.headToHeadWins - left.headToHeadWins || right.pointDifferential - left.pointDifferential;
}
export function getPoolStandings(group: Group, tournament: Tournament): readonly PoolStanding[] {
  if (tournament.style !== 'fixed-round-robin') throw new ValidationError('Rotating tournaments use individual standings.');
  const rows = tournament.teams.map((team) => ({ teamId: team.id, wins: 0, losses: 0, pointDifferential: 0, headToHeadWins: 0 }));
  for (const match of tournament.pool) {
    const game = group.games.find((entry) => entry.id === match.gameId);
    if (game?.status !== 'completed') continue;
    const a = rows.find((row) => row.teamId === match.teamA);
    const b = rows.find((row) => row.teamId === match.teamB);
    if (!a || !b) throw new ValidationError('Invalid pool team.');
    const difference = game.scoreA - game.scoreB;
    a.wins += difference > 0 ? 1 : 0;
    b.wins += difference < 0 ? 1 : 0;
    a.losses += difference < 0 ? 1 : 0;
    b.losses += difference > 0 ? 1 : 0;
    a.pointDifferential += difference;
    b.pointDifferential -= difference;
    if (!Number.isSafeInteger(a.pointDifferential) || !Number.isSafeInteger(b.pointDifferential)) {
      throw new ValidationError('Pool totals exceed the safe numeric range.');
    }
  }
  for (const match of tournament.pool) {
    const winner = matchWinner(group, match);
    const a = rows.find((row) => row.teamId === match.teamA);
    const b = rows.find((row) => row.teamId === match.teamB);
    if (winner && a && b && a.wins === b.wins) {
      if (winner === a.teamId) a.headToHeadWins += 1;
      else b.headToHeadWins += 1;
    }
  }
  return rows.sort(comparePoolStandings);
}

export function getRankedPoolStandings(group: Group, tournament: Tournament): readonly RankedPoolStanding[] {
  const rows = getPoolStandings(group, tournament);
  let rank = 1;
  return rows.map((row, index) => {
    if (index > 0 && comparePoolStandings(rows[index - 1], row) !== 0) rank = index + 1;
    return { ...row, rank };
  });
}

function allocateGame(group: Group, tournament: Tournament, match: TournamentMatch) {
  if (!match.teamA || !match.teamB || match.bye) throw new ValidationError('Both teams must be known before a match can be played.');
  const started = allocateDoublesGame(group, requireTeam(tournament, match.teamA).players, requireTeam(tournament, match.teamB).players, '0');
  const game = started.games[started.games.length - 1];
  const series = match.stage === 'championship' && tournament.scoring?.championship === 'best-of-3-11';
  const gameNumber = (match.gameIds?.length ?? 0) + 1;
  if (series && gameNumber !== 1 && gameNumber !== 2 && gameNumber !== 3) throw new ValidationError('A championship series has at most three games.');
  const tagged: Game = { ...game, tournament: {
    id: tournament.id, matchId: match.id, stage: match.stage, targetScore: targetScore(match.stage, tournament.scoring),
    ...(series && (gameNumber === 1 || gameNumber === 2 || gameNumber === 3) ? { gameNumber } : {}),
  } };
  return {
    group: { ...started, games: started.games.map((entry) => entry.id === game.id ? tagged : entry) },
    match: { ...match, gameId: match.gameId ?? game.id, ...(series ? { gameIds: [...(match.gameIds ?? []), game.id] } : {}) },
  };
}

export function createTournament(group: Group, id: string, name: string, pairs: readonly (readonly string[])[], scoring?: TournamentScoring) {
  const rules = parseTournamentScoring(scoring);
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('Enter a tournament name.');
  if (pairs.length < 2 || pairs.length > MAX_TOURNAMENT_TEAMS) throw new ValidationError('Select 2 to 8 fixed doubles teams.');
  const used = new Set<string>();
  const teams: TournamentTeam[] = pairs.map((pair, index) => {
    if (pair.length !== 2) throw new ValidationError('Each tournament team needs exactly two players.');
    const ids = pair.map(validatePlayerId);
    for (const player of ids) {
      if (!group.players.some((entry) => entry.id === player && !entry.isDeleted) || used.has(player)) {
        throw new ValidationError('Every participant must be a group member and can be on only one team.');
      }
      used.add(player);
    }
    const players: Team = [ids[0], ids[1]];
    return { id: `team-${index + 1}`, players };
  });
  const tournament: Tournament = { id: validatePlayerId(id), name: trimmed, style: 'fixed-round-robin', scoring: rules, teams, pool: [], playoffs: [], seeds: [] };
  const rotation: (string | null)[] = teams.map((team) => team.id);
  if (rotation.length % 2) rotation.push(null);
  let updated = group;
  const pool: TournamentMatch[] = [];
  for (let round = 1; round < rotation.length; round++) {
    for (let index = 0; index < rotation.length / 2; index++) {
      const a = rotation[index];
      const b = rotation[rotation.length - 1 - index];
      if (!a || !b) continue;
      const match: TournamentMatch = {
        id: `pool-${round}-${index + 1}`, stage: 'pool', round, teamA: a, teamB: b,
        fromA: null, fromB: null, bye: false, gameId: null,
      };
      const result = allocateGame(updated, tournament, match);
      updated = result.group;
      pool.push(result.match);
    }
    const last = rotation.pop();
    if (last === undefined) throw new Error('Invalid round-robin rotation.');
    rotation.splice(1, 0, last);
  }
  return { group: updated, tournament: { ...tournament, pool } };
}

export function createRotatingTournament(group: Group, id: string, name: string, players: readonly string[], scoring?: TournamentScoring) {
  const rules = parseTournamentScoring(scoring);
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('Enter a tournament name.');
  const rounds = rotatingRounds(players);
  if (rounds[0].flat().some((id) => !group.players.some((player) => player.id === id && !player.isDeleted))) {
    throw new ValidationError('Every participant must be an active player in this group.');
  }
  const teams: TournamentTeam[] = [];
  const pool: TournamentMatch[] = [];
  let updated = group;
  const tournament: Tournament = { id: validatePlayerId(id), name: trimmed, style: 'rotating-partner-round-robin', scoring: rules,
    teams, pool, playoffs: [], seeds: [] };
  for (const [round, partnerships] of rounds.entries()) {
    for (let index = 0; index < partnerships.length; index += 2) {
      const a = { id: `team-${teams.length + 1}`, players: partnerships[index] };
      const b = { id: `team-${teams.length + 2}`, players: partnerships[index + 1] };
      teams.push(a, b);
      const match: TournamentMatch = { id: `pool-${round + 1}-${index / 2 + 1}`, stage: 'pool', round: round + 1,
        teamA: a.id, teamB: b.id, fromA: null, fromB: null, bye: false, gameId: null };
      const result = allocateGame(updated, tournament, match);
      updated = result.group;
      pool.push(result.match);
    }
  }
  return { group: updated, tournament };
}

function advance(group: Group, tournament: Tournament) {
  let updated = group;
  const playoffs: TournamentMatch[] = [];
  for (const match of tournament.playoffs) {
    const sourceWinner = (id: string) => {
      const source = playoffs.find((entry) => entry.id === id);
      if (!source) throw new ValidationError('Invalid playoff dependency.');
      return matchWinner(updated, source);
    };
    let next = {
      ...match,
      teamA: match.fromA ? sourceWinner(match.fromA) : match.teamA,
      teamB: match.fromB ? sourceWinner(match.fromB) : match.teamB,
    };
    if (!next.bye && next.teamA && next.teamB && !next.gameId) {
      const result = allocateGame(updated, tournament, next);
      updated = result.group;
      next = result.match;
    }
    playoffs.push(next);
  }
  return { group: updated, tournament: { ...tournament, playoffs } };
}

function validateSeeds(group: Group, tournament: Tournament, seeds: readonly string[]) {
  if (!tournament.pool.every((match) => matchWinner(group, match))) throw new ValidationError('Finish every pool game before seeding playoffs.');
  const rows = getPoolStandings(group, tournament);
  if (seeds.length !== rows.length || new Set(seeds).size !== rows.length || seeds.some((id) => !rows.some((row) => row.teamId === id))) {
    throw new ValidationError('Confirm a seed order containing every team exactly once.');
  }
  for (let index = 1; index < seeds.length; index++) {
    const previous = rows.find((row) => row.teamId === seeds[index - 1]);
    const current = rows.find((row) => row.teamId === seeds[index]);
    if (!previous || !current || comparePoolStandings(previous, current) > 0) {
      throw new ValidationError('Seeds must follow wins, head-to-head wins, and pool point differential. Only exact ties may be reordered.');
    }
  }
}

function bracketPositions(count: number) {
  let size = 2;
  let positions = [1, 2];
  while (size < count) {
    size *= 2;
    positions = positions.flatMap((seed) => [seed, size + 1 - seed]);
  }
  return { size, positions };
}

export function startPlayoffs(group: Group, tournament: Tournament, seeds: readonly string[]) {
  if (tournament.style !== 'fixed-round-robin') throw new ValidationError('Rotating-partner tournaments do not have playoffs.');
  if (tournamentPhase(group, tournament) !== 'ready') throw new ValidationError('Finish all pool games and reset any existing playoffs before starting.');
  validateSeeds(group, tournament, seeds);
  const { size, positions } = bracketPositions(seeds.length);
  // The monotonically increasing game counter prevents reuse of match IDs after a reset.
  const generation = group.nextGameNumber;
  const matches: TournamentMatch[] = [];
  const rounds = Math.log2(size);
  let previous: TournamentMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const current: TournamentMatch[] = [];
    for (let index = 0; index < size / (2 ** round); index++) {
      const a = round === 1 ? seeds[positions[index * 2] - 1] ?? null : null;
      const b = round === 1 ? seeds[positions[index * 2 + 1] - 1] ?? null : null;
      current.push({
        id: `playoff-${generation}-${round}-${index + 1}`,
        stage: round === rounds ? 'championship' : 'playoff', round,
        teamA: a, teamB: b,
        fromA: round === 1 ? null : previous[index * 2].id,
        fromB: round === 1 ? null : previous[index * 2 + 1].id,
        bye: round === 1 && (!a || !b), gameId: null,
      });
    }
    matches.push(...current);
    previous = current;
  }
  return advance(group, { ...tournament, seeds: [...seeds], playoffs: matches });
}

export function changeTournament(group: Group, tournament: Tournament, action: Exclude<TournamentAction, { type: 'create' }>) {
  if (action.type === 'start-playoffs') return startPlayoffs(group, tournament, action.seeds);
  if (action.type === 'reset-playoffs') {
    if (tournament.style !== 'fixed-round-robin') throw new ValidationError('Rotating-partner tournaments do not have playoffs.');
    if (!tournament.playoffs.length) throw new ValidationError('There are no playoffs to reset.');
    const updated = { ...group, games: group.games.filter((game) => game.tournament?.id !== tournament.id || game.tournament.stage === 'pool') };
    getStandings(updated);
    return { group: updated, tournament: { ...tournament, playoffs: [], seeds: [], completedAt: null } };
  }
  const match = [...tournament.pool, ...tournament.playoffs].find((entry) => entry.id === action.matchId);
  const game = match && currentMatchGame(group, match);
  if (!match || !game || match.bye) throw new ValidationError('This match is not ready for scoring.');
  if (action.type === 'score') {
    if ((match.gameIds || action.gameId !== undefined) && action.gameId !== game.id) {
      throw new ValidationError('This match has moved to another game. Refresh before entering its score.');
    }
    if (match.stage === 'pool') {
      const round = currentPoolRound(group, tournament);
      if (round !== null && match.round > round) {
        throw new ValidationError(`Complete every game in pool round ${round} before scoring a later round.`);
      }
    }
    validateTournamentScore(match.stage, action.scoreA, action.scoreB, tournament.scoring);
    const updated = recordResult(group, game.id, action.scoreA, action.scoreB);
    if (match.gameIds && !matchWinner(updated, match)) {
      const next = allocateGame(updated, tournament, match);
      return advance(next.group, { ...tournament, playoffs: tournament.playoffs.map(entry => entry.id === match.id ? next.match : entry) });
    }
    return advance(updated, tournament);
  }
  const played = matchGames(group, match);
  if (!played.some(entry => entry.status === 'completed')) throw new ValidationError('This match has no result to reset.');
  if ((match.stage === 'pool' && tournament.playoffs.length) ||
      (match.stage !== 'pool' && match.id !== tournament.playoffs[tournament.playoffs.length - 1]?.id)) {
    throw new ValidationError('Reset all playoffs before correcting a result that affects the bracket.');
  }
  const first = played[0];
  const pending: Game = { id: first.id, status: 'pending', teamA: first.teamA, teamB: first.teamB, wagerUnits: 0, tournament: first.tournament,
    ...(first.createdAt === undefined ? {} : { createdAt: first.createdAt }) };
  const removed = new Set(played.slice(1).map(entry => entry.id));
  const updated = { ...group, games: group.games.filter(entry => !removed.has(entry.id)).map(entry => entry.id === first.id ? pending : entry) };
  getStandings(updated);
  return { group: updated, tournament: { ...tournament, completedAt: null,
    playoffs: tournament.playoffs.map(entry => entry.id === match.id && match.gameIds ? { ...entry, gameIds: [first.id] } : entry) } };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ValidationError('Invalid tournament data.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('Invalid tournament text.');
  return value;
}
function optionalText(value: unknown): string | null { return value === null ? null : text(value); }
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError('Invalid tournament list.');
  return value;
}
export function parseTournament(value: unknown, group: Group): Tournament {
  const row = object(value);
  if (row.style !== 'fixed-round-robin' && row.style !== 'rotating-partner-round-robin') throw new ValidationError('Unsupported tournament style.');
  const rotating = row.style === 'rotating-partner-round-robin';
  const teams = array(row.teams).map((value) => {
    const team = object(value);
    const players = array(team.players).map((id) => validatePlayerId(text(id)));
    if (players.length !== 2 || players[0] === players[1]) throw new ValidationError('A doubles partnership needs two distinct players.');
    const pair: Team = [players[0], players[1]];
    return { id: text(team.id), players: pair };
  });
  const participants = new Set(teams.flatMap((team) => team.players));
  if (new Set(teams.map((team) => team.id)).size !== teams.length ||
      teams.some((team) => team.players.some((id) => !group.players.some((player) => player.id === id)))) {
    throw new ValidationError('Invalid tournament participants.');
  }
  if (rotating) {
    if ((participants.size !== 4 && participants.size !== 8) || teams.length !== participants.size * (participants.size - 1) / 2 ||
        new Set(teams.map((team) => [...team.players].sort().join('|'))).size !== teams.length) {
      throw new ValidationError('Rotating tournaments require every partnership exactly once among 4 or 8 players.');
    }
  } else if (teams.length < 2 || teams.length > MAX_TOURNAMENT_TEAMS || participants.size !== teams.length * 2) {
    throw new ValidationError('Invalid fixed-team participants.');
  }
  function matches(value: unknown): TournamentMatch[] {
    return array(value).map((value) => {
      const match = object(value);
      if ((match.stage !== 'pool' && match.stage !== 'playoff' && match.stage !== 'championship') ||
          typeof match.round !== 'number' || !Number.isSafeInteger(match.round) || match.round < 1 || match.round > 8 ||
          typeof match.bye !== 'boolean') throw new ValidationError('Invalid tournament match.');
      return { id: text(match.id), stage: match.stage, round: match.round, bye: match.bye,
        teamA: optionalText(match.teamA), teamB: optionalText(match.teamB),
        fromA: optionalText(match.fromA), fromB: optionalText(match.fromB), gameId: optionalText(match.gameId),
        ...(match.gameIds === undefined ? {} : { gameIds: array(match.gameIds).map(text) }) };
    });
  }
  const tournament: Tournament = {
    id: validatePlayerId(text(row.id)), name: text(row.name), style: row.style,
    ...(row.scoring === undefined ? {} : { scoring: parseTournamentScoring(row.scoring) }),
    teams, pool: matches(row.pool), playoffs: matches(row.playoffs), seeds: array(row.seeds).map(text),
  };
  const all = [...tournament.pool, ...tournament.playoffs];
  if (tournament.pool.length !== (rotating ? teams.length / 2 : teams.length * (teams.length - 1) / 2) ||
      (rotating && (tournament.playoffs.length !== 0 || tournament.seeds.length !== 0)) || tournament.playoffs.length > 7 ||
      new Set(all.map((match) => match.id)).size !== all.length) throw new ValidationError('Invalid tournament schedule.');
  const pairs = new Set<string>();
  const roundTeams = new Set<string>();
  const usedPartnerships = new Set<string>();
  for (const match of all) {
    for (const teamId of [match.teamA, match.teamB]) if (teamId) requireTeam(tournament, teamId);
    if (match.teamA && match.teamA === match.teamB) throw new ValidationError('A team cannot play itself.');
    if (tournament.pool.includes(match)) {
      if (match.stage !== 'pool' || !match.teamA || !match.teamB || !match.gameId || match.bye || match.fromA || match.fromB) throw new ValidationError('Invalid pool match.');
      pairs.add([match.teamA, match.teamB].sort().join('|'));
      if (match.round > (rotating ? participants.size - 1 : teams.length % 2 ? teams.length : teams.length - 1)) throw new ValidationError('Invalid pool round.');
      const playing = [match.teamA, match.teamB].flatMap((id) => requireTeam(tournament, id).players);
      if (new Set(playing).size !== 4) throw new ValidationError('A tournament game needs four distinct players.');
      for (const id of rotating ? playing : [match.teamA, match.teamB]) {
        const key = `${match.round}:${id}`;
        if (roundTeams.has(key)) throw new ValidationError('A team or player is scheduled twice in one round.');
        roundTeams.add(key);
      }
      if (rotating) for (const id of [match.teamA, match.teamB]) {
        if (usedPartnerships.has(id)) throw new ValidationError('A rotating partnership cannot play twice.');
        usedPartnerships.add(id);
      }
    } else {
      if (match.stage === 'pool') throw new ValidationError('Invalid playoff stage.');
      for (const source of [match.fromA, match.fromB]) {
        if (source && !tournament.playoffs.some((entry) => entry.id === source && entry.round === match.round - 1)) throw new ValidationError('Invalid bracket dependency.');
      }
      if (match.bye && (match.round !== 1 || !!match.teamA === !!match.teamB || match.gameId)) throw new ValidationError('Invalid bye.');
    }
    const series = match.stage === 'championship' && tournament.scoring?.championship === 'best-of-3-11';
    if (match.gameIds !== undefined && (!series || match.gameIds.length < 1 || match.gameIds.length > 3 ||
        match.gameIds[0] !== match.gameId || new Set(match.gameIds).size !== match.gameIds.length)) {
      throw new ValidationError('Invalid championship series games.');
    }
    if (series && match.gameId && !match.gameIds) throw new ValidationError('Championship series games are missing.');
    let aWins = 0, bWins = 0;
    for (const [index, id] of matchGameIds(match).entries()) {
      const game = group.games.find((entry) => entry.id === id);
      if (!game || game.tournament?.id !== tournament.id || game.tournament.matchId !== match.id ||
          game.tournament.stage !== match.stage || game.wagerUnits !== 0 || !match.teamA || !match.teamB ||
          game.teamA.join('|') !== requireTeam(tournament, match.teamA).players.join('|') ||
          game.teamB.join('|') !== requireTeam(tournament, match.teamB).players.join('|')) throw new ValidationError('Invalid tournament game link.');
      const metadata = parseTournamentGameScoring(game.tournament);
      if ((metadata.targetScore !== undefined || tournament.scoring) && metadata.targetScore !== targetScore(match.stage, tournament.scoring) ||
          metadata.gameNumber !== (series ? index + 1 : undefined)) throw new ValidationError('Tournament game scoring rules do not match its saved format.');
      if (series && (aWins === 2 || bWins === 2 || (game.status === 'pending' && index !== matchGameIds(match).length - 1))) {
        throw new ValidationError('A championship series must stop at two wins and score games in order.');
      }
      if (game.status === 'completed') {
        validateTournamentScore(match.stage, String(game.scoreA), String(game.scoreB), tournament.scoring);
        if (game.scoreA > game.scoreB) aWins++;
        else bWins++;
      }
    }
    if (!match.gameId && !match.bye && match.teamA && match.teamB) throw new ValidationError('A ready match is missing its game.');
    if (series && match.gameId && aWins < 2 && bWins < 2 && currentMatchGame(group, match)?.status !== 'pending') {
      throw new ValidationError('An unfinished championship series is missing its next game.');
    }
  }
  if (pairs.size !== tournament.pool.length || (rotating && usedPartnerships.size !== teams.length) ||
      (tournament.playoffs.length ? tournament.seeds.length !== teams.length || new Set(tournament.seeds).size !== teams.length : tournament.seeds.length !== 0) ||
      tournament.seeds.some((id) => !teams.some((team) => team.id === id)) ||
      group.games.some((game) => game.tournament?.id === tournament.id && !all.some((match) => matchGameIds(match).includes(game.id)))) {
    throw new ValidationError('Invalid tournament state.');
  }
  if (tournament.playoffs.length) {
    validateSeeds(group, tournament, tournament.seeds);
    const { size, positions } = bracketPositions(teams.length);
    if (tournament.playoffs.length !== size - 1) throw new ValidationError('Incomplete playoff bracket.');
    let previous: readonly TournamentMatch[] = [];
    let offset = 0;
    for (let round = 1; round <= Math.log2(size); round++) {
      const current = tournament.playoffs.slice(offset, offset + size / (2 ** round));
      for (const [index, match] of current.entries()) {
        const a = round === 1 ? tournament.seeds[positions[index * 2] - 1] ?? null : matchWinner(group, previous[index * 2]);
        const b = round === 1 ? tournament.seeds[positions[index * 2 + 1] - 1] ?? null : matchWinner(group, previous[index * 2 + 1]);
        if (match.round !== round || match.stage !== (round === Math.log2(size) ? 'championship' : 'playoff') ||
            match.teamA !== a || match.teamB !== b ||
            match.fromA !== (round === 1 ? null : previous[index * 2].id) ||
            match.fromB !== (round === 1 ? null : previous[index * 2 + 1].id) ||
            match.bye !== (round === 1 && (!a || !b))) throw new ValidationError('Invalid playoff progression.');
      }
      offset += current.length;
      previous = current;
    }
  }
  return { ...tournament, ...parseActivityTimestamps(row, tournamentPhase(group, tournament) === 'completed') };
}
