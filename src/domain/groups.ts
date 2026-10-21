import type { Game, Group, Standing, Team } from '../types/groups.ts';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new ValidationError('Enter a name.');
  }
  return name;
}

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function createGroup(groups: readonly Group[], name: string): Group {
  const trimmed = cleanName(name);
  if (groups.some((group) => sameName(group.name, trimmed))) {
    throw new ValidationError('A group with that name already exists.');
  }
  return {
    id: `group-${groups.length + 1}`,
    name: trimmed,
    players: [],
    games: [],
    nextGameNumber: 1,
  };
}

export function addPlayer(group: Group, name: string): Group {
  const trimmed = cleanName(name);
  if (group.players.some((player) => sameName(player.name, trimmed))) {
    throw new ValidationError('A player with that name is already in this group.');
  }
  const player = { id: `${group.id}-player-${group.players.length + 1}`, name: trimmed };
  return { ...group, players: [...group.players, player] };
}

export function parseWager(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new ValidationError('Enter a wager in USD, such as 0, 5, or 5.25.');
  }
  const [dollars, fraction = ''] = trimmed.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError('The wager is too large to track precisely.');
  }
  return cents;
}

export function parseScore(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    throw new ValidationError('Scores must be nonnegative whole numbers within the safe numeric range.');
  }
  return Number(trimmed);
}

function validateTeam(group: Group, ids: readonly string[]): Team {
  const [first, second] = ids;
  if (ids.length !== 2 || first === undefined || second === undefined) {
    throw new ValidationError('Select two players for each team.');
  }
  if (!ids.every((id) => group.players.some((player) => player.id === id))) {
    throw new ValidationError('Every selected player must belong to this group.');
  }
  return [first, second];
}

export function startGame(
  group: Group,
  teamAIds: readonly string[],
  teamBIds: readonly string[],
  wager: string,
): Group {
  const teamA = validateTeam(group, teamAIds);
  const teamB = validateTeam(group, teamBIds);
  if (new Set([...teamA, ...teamB]).size !== 4) {
    throw new ValidationError('A doubles game requires four distinct players.');
  }
  const wagerCents = parseWager(wager);
  const game: Game = {
    id: `${group.id}-game-${group.nextGameNumber}`,
    teamA,
    teamB,
    wagerCents,
    status: 'pending',
  };
  return {
    ...group,
    games: [...group.games, game],
    nextGameNumber: group.nextGameNumber + 1,
  };
}

export function recordResult(group: Group, gameId: string, scoreA: string, scoreB: string): Group {
  const game = group.games.find((entry) => entry.id === gameId);
  if (!game) {
    throw new ValidationError('That game no longer exists.');
  }
  if (game.status !== 'pending') {
    throw new ValidationError('This game already has a result. Delete it before entering a replacement.');
  }
  const parsedA = parseScore(scoreA);
  const parsedB = parseScore(scoreB);
  if (parsedA === parsedB) {
    throw new ValidationError('A completed game cannot end in a tie.');
  }
  const completed: Game = { ...game, status: 'completed', scoreA: parsedA, scoreB: parsedB };
  const updated = {
    ...group,
    games: group.games.map((entry) => entry.id === gameId ? completed : entry),
  };
  getStandings(updated);
  return updated;
}

export function deleteGame(group: Group, gameId: string): Group {
  if (!group.games.some((game) => game.id === gameId)) {
    throw new ValidationError('That game no longer exists.');
  }
  const updated = { ...group, games: group.games.filter((game) => game.id !== gameId) };
  getStandings(updated);
  return updated;
}

function addPrecisely(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('This result would make a standings total too large to track precisely.');
  }
  return total;
}

export function getStandings(group: Group): readonly Standing[] {
  const rows = group.players.map((player) => {
    let wins = 0;
    let losses = 0;
    let pointDifferential = 0;
    let moneyCents = 0;
    for (const game of group.games) {
      if (game.status !== 'completed') continue;
      const onA = game.teamA.includes(player.id);
      const onB = game.teamB.includes(player.id);
      if (!onA && !onB) continue;
      const difference = onA ? game.scoreA - game.scoreB : game.scoreB - game.scoreA;
      const won = difference > 0;
      wins += won ? 1 : 0;
      losses += won ? 0 : 1;
      pointDifferential = addPrecisely(pointDifferential, difference);
      moneyCents = addPrecisely(moneyCents, won ? game.wagerCents : -game.wagerCents);
    }
    return { player, wins, losses, pointDifferential, moneyCents, rank: null };
  });
  rows.sort((left, right) => {
    const leftPlayed = left.wins + left.losses > 0;
    const rightPlayed = right.wins + right.losses > 0;
    if (leftPlayed !== rightPlayed) return leftPlayed ? -1 : 1;
    return right.wins - left.wins || right.pointDifferential - left.pointDifferential;
  });
  return rows.map((row) => {
    if (row.wins + row.losses === 0) return row;
    const rank = 1 + rows.filter((other) =>
      other.wins + other.losses > 0 && (
        other.wins > row.wins ||
        (other.wins === row.wins && other.pointDifferential > row.pointDifferential)
      ),
    ).length;
    return { ...row, rank };
  });
}

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError('Money must be represented as safe integer cents.');
  }
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${dollars}.${remainder}`;
}
