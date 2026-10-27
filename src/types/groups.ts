import type { AvatarId } from '../domain/avatars.ts';
import type { GroupAvatarId } from '../domain/groupAvatars.ts';

export type GroupCurrency = 'none' | 'money' | 'boba';

export type Player = {
  // Verified account ID, or a new group-scoped guest/anonymous participant ID.
  readonly id: string;
  readonly code?: string;
  readonly name: string;
  readonly avatar?: AvatarId;
  readonly isGuest?: boolean;
  readonly isDeleted?: boolean;
};

export type Team = readonly [string, string];

export type ActivityTimestamps = {
  readonly createdAt?: string | null;
  readonly completedAt?: string | null;
};

type GameSetup = ActivityTimestamps & {
  readonly id: string;
  readonly teamA: Team;
  readonly teamB: Team;
  readonly wagerUnits: number;
  readonly tournament?: {
    readonly id: string;
    readonly matchId: string;
    readonly stage: 'pool' | 'playoff' | 'championship';
    readonly targetScore?: 11 | 15;
    readonly gameNumber?: 1 | 2 | 3;
  };
};

export type PendingGame = GameSetup & {
  readonly status: 'pending';
};

export type CompletedGame = GameSetup & {
  readonly status: 'completed';
  readonly scoreA: number;
  readonly scoreB: number;
};

export type Game = PendingGame | CompletedGame;

export type Group = {
  readonly id: string;
  readonly name: string;
  readonly currency: GroupCurrency;
  readonly avatar: GroupAvatarId;
  readonly players: readonly Player[];
  readonly games: readonly Game[];
  readonly nextGameNumber: number;
};

export type Standing = {
  readonly player: Player;
  readonly wins: number;
  readonly losses: number;
  readonly pointDifferential: number;
  readonly netUnits: number;
  readonly rank: number | null;
};
