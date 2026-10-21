export type Player = {
  readonly id: string;
  readonly name: string;
};

export type Team = readonly [string, string];

type GameSetup = {
  readonly id: string;
  readonly teamA: Team;
  readonly teamB: Team;
  readonly wagerCents: number;
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
  readonly players: readonly Player[];
  readonly games: readonly Game[];
  readonly nextGameNumber: number;
};

export type Standing = {
  readonly player: Player;
  readonly wins: number;
  readonly losses: number;
  readonly pointDifferential: number;
  readonly moneyCents: number;
  readonly rank: number | null;
};
