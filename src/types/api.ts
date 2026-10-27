import type { Group } from './groups.ts';
import type { GroupAvatarId } from '../domain/groupAvatars.ts';
import { latestCompletedGameAt } from '../domain/timestamps.ts';

export type SavedGroup = Group & {
  readonly ownerId: string;
  readonly ownerName: string;
  readonly revision: string;
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly isOwner: boolean;
  readonly adminIds: readonly string[];
  readonly isPublic: boolean;
};

export type GroupSummary = Omit<SavedGroup, 'players' | 'games' | 'nextGameNumber' | 'adminIds'> & {
  readonly playerCount: number;
  readonly completedGameCount: number;
  readonly latestCompletedAt?: string | null;
};

export function summarizeGroup(group: SavedGroup): GroupSummary {
  return {
    id: group.id, name: group.name, avatar: group.avatar, currency: group.currency,
    ownerId: group.ownerId, ownerName: group.ownerName, revision: group.revision,
    canEdit: group.canEdit, canManage: group.canManage, isOwner: group.isOwner, isPublic: group.isPublic,
    playerCount: group.players.length,
    completedGameCount: group.games.filter((game) => game.status === 'completed').length,
    latestCompletedAt: latestCompletedGameAt(group.games),
  };
}

export type GroupCommand =
  | { readonly type: 'add-player'; readonly playerId: string }
  | { readonly type: 'add-guest'; readonly name: string }
  | { readonly type: 'remove-player'; readonly playerId: string }
  | { readonly type: 'start-game'; readonly teamA: readonly string[]; readonly teamB: readonly string[]; readonly wager: string }
  | { readonly type: 'record-result'; readonly gameId: string; readonly scoreA: string; readonly scoreB: string }
  | { readonly type: 'delete-game'; readonly gameId: string }
  | { readonly type: 'set-visibility'; readonly isPublic: boolean }
  | { readonly type: 'set-avatar'; readonly avatar: GroupAvatarId }
  | { readonly type: 'set-admin'; readonly playerId: string; readonly isAdmin: boolean }
  | { readonly type: 'review-request'; readonly playerId: string; readonly decision: 'approve' | 'decline' };

export type PlayingCommand = Exclude<GroupCommand, { type: 'set-visibility' | 'set-avatar' | 'set-admin' | 'review-request' | 'remove-player' }>;
export type PublicGroup = {
  readonly id: string;
  readonly name: string;
  readonly avatar: GroupAvatarId;
  readonly ownerName: string;
  readonly memberCount: number;
  readonly relationship: 'none' | 'pending' | 'declined' | 'member';
};
export type GroupSearch = { readonly groups: readonly PublicGroup[]; readonly nextCursor: string | null };
export type JoinRequest = { readonly playerId: string; readonly displayName: string; readonly code?: string };
export type GroupLifecycleAction = { readonly type: 'transfer'; readonly playerId: string } | { readonly type: 'delete' };
export type GroupLifecycleReceipt = { readonly groupId: string; readonly action: GroupLifecycleAction['type'] };
export type AccountDeletionStatus = { readonly id: string; readonly status: 'pending' | 'completed'; readonly retrying: boolean };

export function mayChangeGroup(group: SavedGroup, command: GroupCommand): boolean {
  return command.type === 'add-guest' || command.type === 'remove-player' ||
    command.type === 'delete-game' || command.type === 'set-visibility' || command.type === 'set-avatar' ||
    command.type === 'set-admin' || command.type === 'review-request'
    ? group.canManage : group.canEdit;
}
