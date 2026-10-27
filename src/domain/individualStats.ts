import { getStandings } from './groups.ts';
import type { Group, Standing } from '../types/groups.ts';

export type IndividualGroupStanding = {
  readonly groupId: string;
  readonly groupName: string;
  readonly standing: Standing | null;
};

export function getIndividualStandings(groups: readonly Group[], playerId: string): readonly IndividualGroupStanding[] {
  return groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    standing: getStandings(group).find((row) => row.player.id === playerId) ?? null,
  }));
}
