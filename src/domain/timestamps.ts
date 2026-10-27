import { ValidationError } from './groups.ts';
import type { ActivityTimestamps, Game } from '../types/groups.ts';

function timestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ValidationError('Invalid activity timestamp.');
  }
  return value;
}

export function latestCompletedGameAt(games: readonly Game[]): string | null {
  let latest: string | null = null;
  for (const game of games) {
    if (game.status !== 'completed') continue;
    const completedAt = timestamp(game.completedAt);
    if (completedAt !== null && (latest === null || completedAt > latest)) latest = completedAt;
  }
  return latest;
}

export function sortGroupsByActivity<T extends { readonly latestCompletedAt?: string | null }>(groups: readonly T[]): T[] {
  return groups.map(group => ({ group, completedAt: timestamp(group.latestCompletedAt) ?? '' }))
    .sort((a, b) => a.completedAt === b.completedAt ? 0 : a.completedAt > b.completedAt ? -1 : 1)
    .map(entry => entry.group);
}

export function formatGroupActivity(group: { readonly completedGameCount: number; readonly latestCompletedAt?: string | null }): string {
  const completedAt = parseActivityTimestamps({ completedAt: group.latestCompletedAt }, group.completedGameCount > 0).completedAt ?? null;
  if (group.completedGameCount === 0) return 'No completed games';
  return `Last completed: ${completedAt === null ? 'Date unavailable' : new Date(completedAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })}`;
}

export function parseActivityTimestamps(row: { createdAt?: unknown; completedAt?: unknown }, completed: boolean): ActivityTimestamps {
  const createdAt = timestamp(row.createdAt);
  const completedAt = timestamp(row.completedAt);
  if ((!completed && completedAt !== null) || (createdAt !== null && completedAt !== null && completedAt < createdAt)) {
    throw new ValidationError('Activity timestamps do not match its state.');
  }
  return {
    ...(row.createdAt === undefined ? {} : { createdAt }),
    ...(row.completedAt === undefined ? {} : { completedAt }),
  };
}

export function formatActivityTimestamp(completed: boolean, activity: ActivityTimestamps): string {
  const value = timestamp(completed ? activity.completedAt : activity.createdAt);
  const label = completed ? 'Completed' : 'Created';
  return `${label}: ${value === null ? 'Time unavailable' : new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })}`;
}
