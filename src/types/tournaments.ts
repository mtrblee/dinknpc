import type { SavedGroup } from './api.ts';
import type { ActivityTimestamps, Team } from './groups.ts';

export type TournamentTeam = { readonly id: string; readonly players: Team };
export type TournamentStyle = 'fixed-round-robin' | 'rotating-partner-round-robin';
export type TournamentTarget = 11 | 15;
export type ChampionshipFormat = 'single-11' | 'single-15' | 'best-of-3-11';
export type TournamentScoring = {
  readonly pool: TournamentTarget;
  readonly playoff: TournamentTarget;
  readonly championship: ChampionshipFormat;
};
export type TournamentMatch = {
  readonly id: string;
  readonly stage: 'pool' | 'playoff' | 'championship';
  readonly round: number;
  readonly teamA: string | null;
  readonly teamB: string | null;
  readonly fromA: string | null;
  readonly fromB: string | null;
  readonly bye: boolean;
  readonly gameId: string | null;
  readonly gameIds?: readonly string[];
};
export type Tournament = ActivityTimestamps & {
  readonly id: string;
  readonly name: string;
  readonly style: TournamentStyle;
  readonly scoring?: TournamentScoring;
  readonly teams: readonly TournamentTeam[];
  readonly pool: readonly TournamentMatch[];
  readonly playoffs: readonly TournamentMatch[];
  readonly seeds: readonly string[];
};
export type PoolStanding = {
  readonly teamId: string;
  readonly wins: number;
  readonly losses: number;
  readonly pointDifferential: number;
  readonly headToHeadWins: number;
};
export type RankedPoolStanding = PoolStanding & { readonly rank: number };
export type TournamentAction =
  | { readonly type: 'create'; readonly style?: 'fixed-round-robin'; readonly name: string; readonly teams: readonly (readonly string[])[]; readonly scoring?: TournamentScoring }
  | { readonly type: 'create'; readonly style: 'rotating-partner-round-robin'; readonly name: string; readonly players: readonly string[]; readonly scoring?: TournamentScoring }
  | { readonly type: 'score'; readonly id: string; readonly matchId: string; readonly gameId?: string; readonly scoreA: string; readonly scoreB: string }
  | { readonly type: 'start-playoffs'; readonly id: string; readonly seeds: readonly string[] }
  | { readonly type: 'reset-playoffs'; readonly id: string }
  | { readonly type: 'reset-result'; readonly id: string; readonly matchId: string };
export type TournamentCollection = { readonly group: SavedGroup; readonly tournaments: readonly Tournament[] };
export type TournamentResponse = TournamentCollection & { readonly selectedId: string };
