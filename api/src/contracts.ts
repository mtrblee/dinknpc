import { randomUUID } from 'node:crypto';
import type { Group, GroupCurrency, Player } from '../../src/types/groups.ts';
import type { GroupAvatarId } from '../../src/domain/groupAvatars.ts';
import type { AccountDeletionStatus, GroupCommand, GroupLifecycleAction, GroupLifecycleReceipt, GroupSearch, GroupSummary, JoinRequest, PlayingCommand, SavedGroup } from '../../src/types/api.ts';
import { addGuestPlayer, addPlayer, deleteGame, recordResult, startGame } from '../../src/domain/groups.ts';
import type { TournamentAction, TournamentCollection, TournamentResponse } from '../../src/types/tournaments.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface IdentityService {
  authenticate(header: string | null): Promise<{ player: Player; token: string }>;
  findPlayer(id: string, token: string): Promise<Player>;
}

export interface GroupStore {
  ownershipReceipt(actor: Player, requestId: string, fingerprint: string): Promise<GroupLifecycleReceipt | null>;
  changeOwnership(actor: Player, id: string, revision: string, action: GroupLifecycleAction, target: Player | null,
    requestId: string, fingerprint: string): Promise<GroupLifecycleReceipt>;
  prepareAccountDeletion(actor: Player, requestId: string): Promise<AccountDeletionStatus>;
  deletionStatus(id: string): Promise<AccountDeletionStatus>;
  pendingDeletions(): Promise<readonly { id: string; accountId: string }[]>;
  finishDeletion(id: string, accountId: string): Promise<void>;
  failDeletion(id: string): Promise<void>;
  syncPlayer(player: Player): Promise<Player>;
  resolvePlayerCode(actor: Player, code: string): Promise<string>;
  list(actor: Player): Promise<readonly SavedGroup[]>;
  summaries(actor: Player): Promise<readonly GroupSummary[]>;
  get(actor: Player, id: string): Promise<SavedGroup>;
  search(actor: Player, query: string, cursor: string | null): Promise<GroupSearch>;
  requestJoin(actor: Player, id: string, requestId: string, fingerprint: string): Promise<'pending' | 'member' | 'declined'>;
  requests(actor: Player, id: string): Promise<readonly JoinRequest[]>;
  tournaments(actor: Player, id: string): Promise<TournamentCollection>;
  changeTournament(actor: Player, id: string, revision: string | null, action: TournamentAction,
    requestId: string, fingerprint: string): Promise<TournamentResponse>;
  create(actor: Player, name: string, requestId: string, fingerprint: string,
    currency?: GroupCurrency, avatar?: GroupAvatarId): Promise<SavedGroup>;
  change(actor: Player, id: string, revision: string | null, command: GroupCommand, player: Player | null,
    requestId: string, fingerprint: string): Promise<SavedGroup>;
}

export function applyCommand(group: Group, command: PlayingCommand, player: Player | null): Group {
  if ((command.type === 'record-result' || command.type === 'delete-game') &&
      group.games.find((game) => game.id === command.gameId)?.tournament) {
    throw new ApiError(409, 'tournament_game', 'Use the tournament page to score or correct this match.');
  }
  switch (command.type) {
    case 'add-player':
      if (!player || player.isGuest || player.isDeleted || player.id !== command.playerId) throw new ApiError(404, 'player_not_found', 'No eligible player was found.');
      return addPlayer(group, player);
    case 'add-guest': return addGuestPlayer(group, randomUUID(), command.name);
    case 'start-game': return startGame(group, command.teamA, command.teamB, command.wager);
    case 'record-result': return recordResult(group, command.gameId, command.scoreA, command.scoreB);
    case 'delete-game': return deleteGame(group, command.gameId);
  }
}
