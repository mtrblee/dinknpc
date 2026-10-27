import { DEFAULT_AVATAR } from './avatars.ts';
import { getStandings, validatePlayerId, ValidationError } from './groups.ts';
import { parseTournament } from './tournaments.ts';
import type { Group, Player, Team } from '../types/groups.ts';
import type { Tournament } from '../types/tournaments.ts';

export function anonymizeParticipant(group: Group, tournaments: readonly Tournament[], value: string, replacementId: string) {
  const playerId = validatePlayerId(value);
  const player = group.players.find((entry) => entry.id === playerId);
  if (!player || player.isGuest || player.isDeleted) throw new ValidationError('An active registered participant is required.');
  const id = validatePlayerId(replacementId);
  if (group.players.some((entry) => entry.id === id)) throw new ValidationError('The anonymous participant must have a new identity.');
  const retained = group.games.some((game) => [...game.teamA, ...game.teamB].includes(playerId)) ||
    tournaments.some((tournament) => tournament.teams.some((team) => team.players.includes(playerId)));
  const anonymous: Player | null = retained ? { id, name: 'Deleted player', avatar: DEFAULT_AVATAR, isDeleted: true } : null;
  const replaceTeam = (team: Team): Team => [team[0] === playerId ? id : team[0], team[1] === playerId ? id : team[1]];
  const updated: Group = {
    ...group,
    players: group.players.flatMap((entry) => entry.id === playerId ? anonymous ? [anonymous] : [] : [entry]),
    games: group.games.map((game) => ({ ...game, teamA: replaceTeam(game.teamA), teamB: replaceTeam(game.teamB) })),
  };
  const changed = tournaments.map((tournament) => ({
    ...tournament, teams: tournament.teams.map((team) => ({ ...team, players: replaceTeam(team.players) })),
  }));
  getStandings(updated);
  for (const tournament of changed) parseTournament(tournament, updated);
  return { group: updated, tournaments: changed, anonymous };
}
