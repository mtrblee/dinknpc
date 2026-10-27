import { validatePlayerId, ValidationError } from './groups.ts';
import type { Team } from '../types/groups.ts';

// Each round uses every player once; across rounds, each partnership occurs once
// and each pair of players meets as opponents twice.
const fourPlayerRounds = [
  [0, 1, 2, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
] as const;
const eightPlayerRounds = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [0, 2, 4, 6, 3, 1, 7, 5],
  [0, 4, 3, 7, 6, 2, 5, 1],
  [0, 3, 6, 5, 7, 4, 1, 2],
  [0, 6, 7, 1, 5, 3, 2, 4],
  [0, 7, 5, 2, 1, 6, 4, 3],
  [0, 5, 1, 4, 2, 7, 3, 6],
] as const;

export function rotatingRounds(playerIds: readonly string[]): readonly (readonly Team[])[] {
  if (playerIds.length !== 4 && playerIds.length !== 8) {
    throw new ValidationError('Select exactly 4 or 8 players for rotating partners. Six players cannot partner with everyone exactly once.');
  }
  const players = playerIds.map(validatePlayerId);
  if (new Set(players).size !== players.length) throw new ValidationError('Choose distinct players for rotating partners.');
  return (players.length === 4 ? fourPlayerRounds : eightPlayerRounds).map((round) => {
    const teams: Team[] = [];
    for (let index = 0; index < round.length; index += 2) {
      teams.push([players[round[index]], players[round[index + 1]]]);
    }
    return teams;
  });
}
