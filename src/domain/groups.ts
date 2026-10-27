import type { Game, Group, GroupCurrency, Player, Standing, Team } from '../types/groups.ts';
import type { Tournament } from '../types/tournaments.ts';
import { validateAvatar } from './avatars.ts';
import { DEFAULT_GROUP_AVATAR, validateGroupAvatar } from './groupAvatars.ts';
import type { GroupAvatarId } from './groupAvatars.ts';

export const CURRENCY_OPTIONS = [
  { id: 'none', label: 'None' },
  { id: 'money', label: '\u{1F4B5} Money' },
  { id: 'boba', label: '\u{1F9CB} Boba' },
] as const;

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

export function validateCurrency(value: unknown): GroupCurrency {
  const currency = CURRENCY_OPTIONS.find((entry) => entry.id === value);
  if (!currency) throw new ValidationError('Choose None, Money, or Boba as the group currency.');
  return currency.id;
}

export function createGroup(
  groups: readonly Pick<Group, 'name'>[], name: string,
  currency: GroupCurrency = 'none', avatar: GroupAvatarId = DEFAULT_GROUP_AVATAR,
): Group {
  const trimmed = cleanName(name);
  if (groups.some((group) => sameName(group.name, trimmed))) {
    throw new ValidationError('A group with that name already exists.');
  }
  return {
    id: `group-${groups.length + 1}`,
    name: trimmed,
    currency: validateCurrency(currency),
    avatar: validateGroupAvatar(avatar),
    players: [],
    games: [],
    nextGameNumber: 1,
  };
}

export function validatePlayerId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new ValidationError('Enter the full player ID shared by a registered player.');
  }
  return id;
}

export const PLAYER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function validatePlayerCode(value: string): string {
  const code = value.trim();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/i.test(code)) {
    throw new ValidationError('Enter a six-character player code using letters and numbers (no I, O, 0, or 1).');
  }
  return code.toUpperCase();
}

export function validatePlayerReference(value: string): string {
  return value.trim().length === 36 ? validatePlayerId(value) : validatePlayerCode(value);
}

export function addPlayer(group: Group, registeredPlayer: Player): Group {
  if (registeredPlayer.isDeleted) throw new ValidationError('Deleted players cannot join groups.');
  if (registeredPlayer.isGuest) throw new ValidationError('Guests must be added by name, not by account ID.');
  return appendPlayer(group, registeredPlayer);
}

export function addGuestPlayer(group: Group, id: string, name: string): Group {
  const trimmed = cleanName(name);
  if (group.players.some((player) => player.isGuest && sameName(player.name.trim(), trimmed))) {
    throw new ValidationError('A guest with that name already exists in this group.');
  }
  return appendPlayer(group, { id, name: trimmed, isGuest: true });
}

export function removePlayer(group: Group, playerId: string, tournaments: readonly Tournament[]): Group {
  const id = validatePlayerId(playerId);
  if (!group.players.some((player) => player.id === id)) {
    throw new ValidationError('This player is no longer in the group. Refresh the roster.');
  }
  if (group.games.some((game) => [...game.teamA, ...game.teamB].includes(id)) ||
      tournaments.some((tournament) => tournament.teams.some((team) => team.players.includes(id)))) {
    throw new ValidationError('This player cannot be removed because they appear in a game or tournament.');
  }
  return { ...group, players: group.players.filter((player) => player.id !== id) };
}

function appendPlayer(group: Group, entry: Player): Group {
  const id = validatePlayerId(entry.id);
  const name = cleanName(entry.name);
  if (group.players.some((player) => player.id === id)) {
    throw new ValidationError(entry.isGuest ? 'This guest is already in the group.' : 'This account is already in the group.');
  }
  const player: Player = { id, name,
    ...(entry.code === undefined || entry.isGuest ? {} : { code: validatePlayerCode(entry.code) }),
    ...(entry.isGuest ? { isGuest: true } : {}),
    ...(entry.avatar === undefined ? {} : { avatar: validateAvatar(entry.avatar) }) };
  return { ...group, players: [...group.players, player] };
}

export function getPlayerDisplayName(player: Player): string {
  if (player.isDeleted) return 'Deleted player';
  return player.isGuest ? `(g) ${player.name}` : player.name;
}

export function getPlayerLabel(group: Group, player: Player): string {
  const name = getPlayerDisplayName(player);
  const matchingName = group.players.some((other) => other.id !== player.id && sameName(getPlayerDisplayName(other), name));
  return matchingName ? `${name} (${getPlayerReference(player)})` : name;
}

export function getPlayerReference(player: Player): string {
  return !player.isGuest && !player.isDeleted && player.code ? player.code : player.id;
}

export function parseWager(value: string, currency: GroupCurrency): number {
  validateCurrency(currency);
  const trimmed = value.trim() || '0';
  if (currency === 'none') {
    if (!/^0+(?:\.0+)?$/.test(trimmed)) throw new ValidationError('This group does not use simulated wagers.');
    return 0;
  }
  if (currency === 'boba') {
    if (!/^\d+$/.test(trimmed)) throw new ValidationError('Enter a whole number of bobas, such as 0, 1, or 2.');
    const units = Number(trimmed);
    if (!Number.isSafeInteger(units)) throw new ValidationError('The wager is too large to track precisely.');
    return units;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new ValidationError('Enter whole dollars only: 0 for no wager, or at least 1. Cents are not allowed.');
  }
  const cents = Number(trimmed) * 100;
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
  if ([...teamAIds, ...teamBIds].some((id) => group.players.some((player) => player.id === id && player.isDeleted))) {
    throw new ValidationError('Deleted players cannot be selected for new games.');
  }
  return allocateDoublesGame(group, teamAIds, teamBIds, wager);
}

// Existing fixed tournaments may continue with anonymous participants; new setups use startGame.
export function allocateDoublesGame(
  group: Group,
  teamAIds: readonly string[],
  teamBIds: readonly string[],
  wager: string,
): Group {
  if (!Number.isSafeInteger(group.nextGameNumber) || group.nextGameNumber < 1 ||
      group.nextGameNumber >= Number.MAX_SAFE_INTEGER) {
    throw new ValidationError('This group cannot safely allocate another game number.');
  }
  const teamA = validateTeam(group, teamAIds);
  const teamB = validateTeam(group, teamBIds);
  if (new Set([...teamA, ...teamB]).size !== 4) {
    throw new ValidationError('A doubles game requires four distinct players.');
  }
  const wagerUnits = parseWager(wager, group.currency);
  const game: Game = {
    id: `${group.id}-game-${group.nextGameNumber}`,
    teamA,
    teamB,
    wagerUnits,
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
  validateCurrency(group.currency);
  for (const game of group.games) {
    if (!Number.isSafeInteger(game.wagerUnits) || game.wagerUnits < 0) {
      throw new ValidationError('Wagers must use nonnegative safe integer units.');
    }
    if (game.wagerUnits !== 0 && (group.currency === 'none' || game.tournament)) {
      throw new ValidationError('This group or tournament does not allow simulated wagers.');
    }
  }
  const rows = group.players.map((player) => {
    let wins = 0;
    let losses = 0;
    let pointDifferential = 0;
    let netUnits = 0;
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
      netUnits = addPrecisely(netUnits, won ? game.wagerUnits : -game.wagerUnits);
    }
    return { player, wins, losses, pointDifferential, netUnits, rank: null };
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

export function currencySymbol(currency: Exclude<GroupCurrency, 'none'>): string {
  if (currency === 'money') return '\u{1F4B5}';
  if (currency === 'boba') return '\u{1F9CB}';
  throw new ValidationError('This currency has no simulated amounts.');
}

export function formatUnits(units: number, currency: Exclude<GroupCurrency, 'none'>): string {
  if (currency === 'money') return formatMoney(units);
  if (currency !== 'boba' || !Number.isSafeInteger(units)) {
    throw new ValidationError('Boba must be represented as safe whole-number units.');
  }
  return String(units);
}
