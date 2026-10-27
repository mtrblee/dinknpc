import { parseScore, ValidationError } from './groups.ts';
import type { Game } from '../types/groups.ts';
import type { ChampionshipFormat, TournamentMatch, TournamentScoring, TournamentTarget } from '../types/tournaments.ts';

export const DEFAULT_TOURNAMENT_SCORING: TournamentScoring = Object.freeze({
  pool: 11, playoff: 15, championship: 'single-15',
});

export function validateTournamentTarget(value: unknown): TournamentTarget {
  if (value !== 11 && value !== 15) throw new ValidationError('Choose one game to 11 or 15.');
  return value;
}

export function validateChampionshipFormat(value: unknown): ChampionshipFormat {
  if (value !== 'single-11' && value !== 'single-15' && value !== 'best-of-3-11') {
    throw new ValidationError('Choose one championship game to 11 or 15, or best two of three games to 11.');
  }
  return value;
}

export function parseTournamentScoring(value: unknown): TournamentScoring {
  if (value === undefined) return { ...DEFAULT_TOURNAMENT_SCORING };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Choose valid tournament scoring rules.');
  }
  const row = Object.fromEntries(Object.entries(value));
  return {
    pool: validateTournamentTarget(row.pool), playoff: validateTournamentTarget(row.playoff),
    championship: validateChampionshipFormat(row.championship),
  };
}

export function targetScore(stage: TournamentMatch['stage'], scoring = DEFAULT_TOURNAMENT_SCORING): TournamentTarget {
  if (stage === 'pool' || stage === 'playoff') return validateTournamentTarget(scoring[stage]);
  if (stage === 'championship') return validateChampionshipFormat(scoring.championship) === 'single-15' ? 15 : 11;
  throw new ValidationError('Unsupported tournament stage.');
}

export function tournamentScoringLabel(stage: TournamentMatch['stage'], scoring = DEFAULT_TOURNAMENT_SCORING): string {
  return stage === 'championship' && scoring.championship === 'best-of-3-11'
    ? 'Best 2 of 3 games to 11' : `1 game to ${targetScore(stage, scoring)}`;
}

export function validateTournamentScore(stage: TournamentMatch['stage'], a: string, b: string, scoring?: TournamentScoring) {
  const scoreA = parseScore(a), scoreB = parseScore(b);
  const winner = Math.max(scoreA, scoreB), loser = Math.min(scoreA, scoreB);
  const target = targetScore(stage, scoring);
  if (winner < target || winner - loser < 2 || (winner > target && winner - loser !== 2)) {
    throw new ValidationError(`This game is to ${target}, win by two with no cap. Enter a score that ends when a team first wins.`);
  }
}

export function parseTournamentGameScoring(tag: Record<string, unknown>): Pick<NonNullable<Game['tournament']>, 'targetScore' | 'gameNumber'> {
  const target = tag.targetScore === undefined ? undefined : validateTournamentTarget(tag.targetScore);
  if (tag.gameNumber === undefined) return target === undefined ? {} : { targetScore: target };
  if (tag.stage !== 'championship' || target !== 11 ||
      (tag.gameNumber !== 1 && tag.gameNumber !== 2 && tag.gameNumber !== 3)) {
    throw new ValidationError('A championship series has only games 1 to 3, each played to 11.');
  }
  return { targetScore: target, gameNumber: tag.gameNumber };
}
