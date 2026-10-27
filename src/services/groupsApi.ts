import { getStandings, validateCurrency, validatePlayerCode, validatePlayerId, validatePlayerReference, ValidationError } from '../domain/groups.ts';
import type { Game, GroupCurrency, Player, Team } from '../types/groups.ts';
import { DEFAULT_GROUP_AVATAR, validateGroupAvatar } from '../domain/groupAvatars.ts';
import type { GroupAvatarId } from '../domain/groupAvatars.ts';
import type { AccountDeletionStatus, GroupCommand, GroupLifecycleAction, GroupLifecycleReceipt, GroupSearch, GroupSummary, JoinRequest, PublicGroup, SavedGroup } from '../types/api.ts';
import type { TournamentAction, TournamentCollection, TournamentResponse } from '../types/tournaments.ts';
import { parseTournament } from '../domain/tournaments.ts';
import { parseTournamentGameScoring, parseTournamentScoring } from '../domain/tournamentScoring.ts';
import { validateAvatar } from '../domain/avatars.ts';
import { parseActivityTimestamps } from '../domain/timestamps.ts';
import { summarizeGroup } from '../types/api.ts';

export class DataError extends Error {
  readonly status: number;
  constructor(message: string, status = 0, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DataError';
    this.status = status;
  }
}
export type GroupLoadTiming = {
  operation: 'summaries' | 'statistics' | 'group';
  status: number;
  durationMs: number;
  sessionMs: number;
  requestMs: number;
  decodeMs: number;
  responseCharacters: number;
};

export interface GroupsApi {
  changeOwnership(group: SavedGroup, action: GroupLifecycleAction): Promise<GroupLifecycleReceipt>;
  deleteAccount(session: { userId: string; accessToken: string }, requestId: string): Promise<AccountDeletionStatus>;
  deletionStatus(id: string): Promise<AccountDeletionStatus>;
  syncProfile(): Promise<Player>;
  list(): Promise<readonly SavedGroup[]>;
  summaries(): Promise<readonly GroupSummary[]>;
  get(id: string): Promise<SavedGroup>;
  create(name: string, currency?: GroupCurrency, avatar?: GroupAvatarId): Promise<SavedGroup>;
  change(group: SavedGroup, command: GroupCommand): Promise<SavedGroup>;
  search(query: string, cursor?: string | null): Promise<GroupSearch>;
  requestJoin(id: string): Promise<'pending' | 'member' | 'declined'>;
  requests(id: string): Promise<readonly JoinRequest[]>;
  tournaments(id: string): Promise<TournamentCollection>;
  changeTournament(group: SavedGroup, action: TournamentAction): Promise<TournamentResponse>;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error('Expected an object.');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty text.');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Expected a safe integer.');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array.');
  return value;
}
function parsePlayer(value: unknown): Player {
  const player = object(value);
  if (player.isGuest !== undefined && typeof player.isGuest !== 'boolean') throw new Error('Invalid player type.');
  if (player.isDeleted !== undefined && typeof player.isDeleted !== 'boolean') throw new Error('Invalid deleted-player marker.');
  if (player.isDeleted && (player.isGuest || player.name !== 'Deleted player' || player.avatar !== 'smile')) throw new Error('Invalid anonymous player.');
  if (player.code !== undefined && (player.isGuest || player.isDeleted)) throw new Error('Only registered accounts have player codes.');
  return { id: validatePlayerId(string(player.id)), name: string(player.name),
    ...(player.code === undefined ? {} : { code: validatePlayerCode(string(player.code)) }),
    ...(player.isGuest === true ? { isGuest: true } : {}),
    ...(player.isDeleted === true ? { isDeleted: true } : {}),
    ...(player.avatar === undefined ? {} : { avatar: validateAvatar(player.avatar) }) };
}
function parseAccess(row: Record<string, unknown>) {
  if (typeof row.canEdit !== 'boolean' || typeof row.canManage !== 'boolean' || typeof row.isOwner !== 'boolean' ||
      (row.isOwner && !row.canManage) || (row.canManage && !row.canEdit)) throw new Error('Invalid group access metadata.');
  return { canEdit: row.canEdit, canManage: row.canManage, isOwner: row.isOwner };
}
function parseGroup(value: unknown): SavedGroup {
  try {
    const row = object(value);
    const players = array(row.players).map(parsePlayer);
    const codes = players.flatMap(player => player.code ? [player.code] : []);
    if (new Set(codes).size !== codes.length) throw new Error('Duplicate player codes.');
    const playerIds = new Set(players.map((player) => player.id));
    if (playerIds.size !== players.length) throw new Error('Duplicate player IDs.');
    const ownerId = validatePlayerId(string(row.ownerId));
    const adminIds = array(row.adminIds).map(id => validatePlayerId(string(id)));
    if (new Set(adminIds).size !== adminIds.length || adminIds.some(id => id === ownerId ||
        !players.some(player => player.id === id && !player.isGuest && !player.isDeleted))) throw new Error('Invalid group admins.');
    function team(value: unknown): Team {
      const ids = array(value).map((id) => validatePlayerId(string(id)));
      if (ids.length !== 2 || !ids.every((id) => playerIds.has(id))) throw new Error('Invalid team.');
      return [ids[0], ids[1]];
    }
    const games: Game[] = array(row.games).map((value) => {
      const game = object(value);
      let tournament: Game['tournament'];
      if (game.tournament !== undefined) {
        const tag = object(game.tournament);
        if (tag.stage !== 'pool' && tag.stage !== 'playoff' && tag.stage !== 'championship') throw new Error('Invalid tournament stage.');
        tournament = { id: validatePlayerId(string(tag.id)), matchId: string(tag.matchId), stage: tag.stage, ...parseTournamentGameScoring(tag) };
      }
      const setup = { id: string(game.id), teamA: team(game.teamA), teamB: team(game.teamB), wagerUnits: integer(game.wagerUnits),
        ...parseActivityTimestamps(game, game.status === 'completed'),
        ...(tournament ? { tournament } : {}) };
      if (new Set([...setup.teamA, ...setup.teamB]).size !== 4) throw new Error('Duplicate team players.');
      if (game.status === 'pending') return { ...setup, status: 'pending' };
      if (game.status !== 'completed') throw new Error('Invalid game status.');
      const scoreA = integer(game.scoreA);
      const scoreB = integer(game.scoreB);
      if (scoreA === scoreB) throw new Error('Tied result.');
      return { ...setup, status: 'completed', scoreA, scoreB };
    });
    const revision = string(row.revision);
    const nextGameNumber = integer(row.nextGameNumber);
    if (!/^[0-9a-f]{16}$/.test(revision) || nextGameNumber < 1 || typeof row.canEdit !== 'boolean' ||
        typeof row.canManage !== 'boolean' || typeof row.isPublic !== 'boolean' ||
        new Set(games.map((game) => game.id)).size !== games.length) throw new Error('Invalid group metadata.');
    const group: SavedGroup = {
      id: validatePlayerId(string(row.id)), name: string(row.name), players, games, nextGameNumber,
      currency: validateCurrency(row.currency), avatar: validateGroupAvatar(row.avatar),
      ownerId, ownerName: string(row.ownerName), revision, ...parseAccess(row), adminIds, isPublic: row.isPublic,
    };
    getStandings(group);
    return group;
  } catch (cause) {
    throw new DataError('The service returned invalid group data. Your local view was not replaced.', 502, { cause });
  }
}

function parseSummary(value: unknown): GroupSummary {
  try {
    const row = object(value);
    const revision = string(row.revision);
    if (!/^[0-9a-f]{16}$/.test(revision) || typeof row.canEdit !== 'boolean' ||
        typeof row.canManage !== 'boolean' || typeof row.isPublic !== 'boolean') throw new Error('Invalid group metadata.');
    const completedGameCount = integer(row.completedGameCount);
    const activity = parseActivityTimestamps({ completedAt: row.latestCompletedAt }, completedGameCount > 0);
    return {
      id: validatePlayerId(string(row.id)), name: string(row.name), avatar: validateGroupAvatar(row.avatar),
      currency: validateCurrency(row.currency), ownerId: validatePlayerId(string(row.ownerId)), ownerName: string(row.ownerName),
      revision,       ...parseAccess(row), isPublic: row.isPublic,
      playerCount: integer(row.playerCount), completedGameCount,
      ...(row.latestCompletedAt === undefined ? {} : { latestCompletedAt: activity.completedAt ?? null }),
    };
  } catch (cause) {
    throw new DataError('The service returned invalid group summaries. Your local view was not replaced.', 502, { cause });
  }
}

export function apiBaseUrl(value: string | undefined): string {
  if (!value) throw new DataError('Saved groups are not configured. Set EXPO_PUBLIC_API_URL in .env and restart Expo.');
  let url: URL;
  try { url = new URL(value); }
  catch (cause) { throw new DataError('EXPO_PUBLIC_API_URL is invalid.', 0, { cause }); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new DataError('The data service must use an HTTPS URL without credentials or query parameters.');
  }
  return url.toString().replace(/\/$/, '');
}

function parseTournamentCollection(value: unknown): TournamentCollection {
  const result = object(value);
  const group = parseGroup(result.group);
  const tournaments = array(result.tournaments).map((entry) => parseTournament(entry, group));
  if (new Set(tournaments.map((entry) => entry.id)).size !== tournaments.length) throw new Error('Duplicate tournaments.');
  return { group, tournaments };
}

function parseDeletionStatus(value: unknown, expectedId?: string): AccountDeletionStatus {
  try {
    const row = object(value);
    const id = validatePlayerId(string(row.id));
    if ((expectedId && expectedId !== id) || (row.status !== 'pending' && row.status !== 'completed') ||
        typeof row.retrying !== 'boolean' || (row.status === 'completed' && row.retrying)) throw new Error('Invalid deletion receipt.');
    return { id, status: row.status, retrying: row.retrying };
  } catch (cause) { throw new DataError('The deletion status could not be confirmed. Retry checking your receipt.', 502, { cause }); }
}

export function createGroupsApi(
  baseUrl: string,
  userId: string,
  getToken: () => Promise<{ userId: string; accessToken: string }>,
  createRequestId: () => string,
  fetcher = fetch,
  reportTiming?: (timing: GroupLoadTiming) => void,
): GroupsApi {
  const pending = new Map<string, string>();
  let reportedLegacyList = false;

  async function request<T>(
    path: string, method: string, input: object | undefined, revision: string | undefined,
    decode: (data: unknown) => T,
    credentials?: { userId: string; accessToken: string } | false,
    requestId?: string,
  ): Promise<T> {
    const started = performance.now();
    const session = credentials === undefined ? await getToken() : credentials;
    const sessionFinished = performance.now();
    if (session && session.userId !== userId) throw new DataError('The signed-in account changed. Reopen your groups.', 401);
    const operation = JSON.stringify([method, path, input, revision]);
    let key: string | undefined;
    if (method !== 'GET') {
      key = requestId ?? pending.get(operation) ?? createRequestId();
      pending.set(operation, key);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const operationName = method !== 'GET' ? null : path === '/groups?view=summary' ? 'summaries'
      : path === '/groups' ? 'statistics' : /^\/groups\/[0-9a-f-]{36}$/i.test(path) ? 'group' : null;
    let status = 0;
    let responseCharacters = 0;
    let readFinished: number | undefined;
    try {
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
            ...(revision ? { 'If-Match': `"${revision}"` } : {}),
          },
          body: input ? JSON.stringify(input) : undefined,
          signal: controller.signal,
        });
      } catch (cause) {
        throw new DataError('Could not reach the data service. Retry the same action to safely check whether it was saved.', 0, { cause });
      }
      status = response.status;
      let data: unknown;
      try {
        const text = await response.text();
        responseCharacters = text.length;
        readFinished = performance.now();
        data = JSON.parse(text);
      }
      catch (cause) { throw new DataError('The data service returned an unreadable response. Please retry.', 502, { cause }); }
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) pending.delete(operation);
        const error = isObject(data) && isObject(data.error) ? data.error : null;
        throw new DataError(typeof error?.message === 'string' ? error.message : 'The data request failed. Please retry.', response.status);
      }
      const decoded = decode(data);
      pending.delete(operation);
      return decoded;
    } finally {
      clearTimeout(timeout);
      if (operationName && reportTiming) {
        const finished = performance.now();
        reportTiming({
          operation: operationName, status, durationMs: Math.round(finished - started),
          sessionMs: Math.round(sessionFinished - started),
          requestMs: Math.round((readFinished ?? finished) - sessionFinished),
          decodeMs: readFinished === undefined ? 0 : Math.round(finished - readFinished),
          responseCharacters,
        });
      }
    }
  }
  function groupRequest(path: string, method = 'GET', input?: object, revision?: string) {
    return request(path, method, input, revision, (data) => parseGroup(isObject(data) ? data.group : undefined));
  }
  return {
    changeOwnership(group, action) {
      const path = `/groups/${encodeURIComponent(group.id)}`;
      return request(action.type === 'transfer' ? `${path}/owner` : path, action.type === 'transfer' ? 'POST' : 'DELETE',
        action.type === 'transfer' ? { playerId: action.playerId } : { confirmation: 'DELETE' }, group.revision, (data) => {
          if (!isObject(data) || data.groupId !== group.id || data.action !== action.type) {
            throw new DataError('The group change could not be confirmed. Retry the same action to check it.', 502);
          }
          return { groupId: group.id, action: action.type };
        });
    },
    deleteAccount(session, requestId) {
      return request('/me', 'DELETE', { confirmation: 'DELETE' }, undefined, (data) => parseDeletionStatus(data),
        session, validatePlayerId(requestId));
    },
    deletionStatus(id) {
      const receipt = validatePlayerId(id);
      return request(`/account-deletions/${receipt}`, 'GET', undefined, undefined,
        (data) => parseDeletionStatus(data, receipt), false);
    },
    async list() {
      return request('/groups', 'GET', undefined, undefined, (data) => {
        if (!isObject(data) || !Array.isArray(data.groups)) throw new DataError('The group list response is invalid.', 502);
        const groups = data.groups.map(parseGroup);
        if (new Set(groups.map((group) => group.id)).size !== groups.length) throw new DataError('The group list contains duplicate IDs.', 502);
        return groups;
      });
    },
    summaries() {
      return request('/groups?view=summary', 'GET', undefined, undefined, (data) => {
        if (!isObject(data) || !Array.isArray(data.groups)) throw new DataError('The group summary response is invalid.', 502);
        // Older servers ignore the view query and return their valid full-group contract.
        const legacy = data.groups.length > 0 && data.groups.every((row: unknown) =>
          isObject(row) && Array.isArray(row.players) && Array.isArray(row.games) && row.playerCount === undefined);
        const groups = legacy ? data.groups.map((row: unknown) => summarizeGroup(parseGroup(row))) : data.groups.map(parseSummary);
        if (new Set(groups.map((group) => group.id)).size !== groups.length) throw new DataError('The group summaries contain duplicate IDs.', 502);
        if (legacy && !reportedLegacyList) {
          reportedLegacyList = true;
          console.warn('The API returned full group histories. Deploy the summary API to reduce startup data loading.');
        }
        return groups;
      });
    },
    syncProfile() {
      return request('/me', 'GET', undefined, undefined, (data) => {
        try {
          const player = parsePlayer(object(data).player);
          if (player.isGuest || player.isDeleted || player.id !== userId) throw new Error('Profile does not belong to the current account.');
          return player;
        } catch (cause) { throw new DataError('The service returned an invalid player profile. Please retry.', 502, { cause }); }
      });
    },
    get: (id) => groupRequest(`/groups/${encodeURIComponent(id)}`),
    create: (name, currency = 'none', avatar = DEFAULT_GROUP_AVATAR) =>
      groupRequest('/groups', 'POST', { name, currency: validateCurrency(currency), avatar: validateGroupAvatar(avatar) }),
    tournaments(id) {
      return request(`/groups/${encodeURIComponent(id)}/tournaments`, 'GET', undefined, undefined, (data) => {
        try {
          return parseTournamentCollection(data);
        } catch (cause) { throw new DataError('The tournament response is invalid. Please refresh.', 502, { cause }); }
      });
    },
    changeTournament(group, action) {
      const base = `/groups/${encodeURIComponent(group.id)}/tournaments`;
      let path: string;
      let method = 'POST';
      let input: object | undefined;
      if (action.type === 'create') {
        path = action.scoring === undefined ? base : `${base}/configured`;
        const scoring = action.scoring === undefined ? {} : { scoring: parseTournamentScoring(action.scoring) };
        input = action.style === 'rotating-partner-round-robin'
          ? { name: action.name, players: action.players, style: action.style, ...scoring }
          : { name: action.name, teams: action.teams, style: 'fixed-round-robin', ...scoring };
      } else {
        path = `${base}/${encodeURIComponent(action.id)}`;
        if (action.type === 'start-playoffs') { path += '/playoffs'; input = { seeds: action.seeds }; }
        else if (action.type === 'reset-playoffs') { path += '/playoffs'; method = 'DELETE'; }
        else {
          path += `/matches/${encodeURIComponent(action.matchId)}/result`;
          if (action.type === 'score') input = { scoreA: action.scoreA, scoreB: action.scoreB,
            ...(action.gameId === undefined ? {} : { gameId: action.gameId }) };
          else method = 'DELETE';
        }
      }
      return request(path, method, input, action.type === 'create' ? undefined : group.revision, (data) => {
        try {
          const result = parseTournamentCollection(data);
          const selectedId = validatePlayerId(string(object(data).selectedId));
          if (!result.tournaments.some((entry) => entry.id === selectedId)) throw new Error('Missing selected tournament.');
          return { ...result, selectedId };
        } catch (cause) { throw new DataError('The tournament save response is invalid. Retry the same action to check its status.', 502, { cause }); }
      });
    },
    search(query, cursor) {
      const parameters = new URLSearchParams({ query });
      if (cursor) parameters.set('cursor', cursor);
      return request(`/groups/search?${parameters}`, 'GET', undefined, undefined, (data) => {
        try {
          const result = object(data);
          const groups: PublicGroup[] = array(result.groups).map((value) => {
            const row = object(value);
            const relationship = row.relationship;
            if (relationship !== 'none' && relationship !== 'pending' && relationship !== 'declined' && relationship !== 'member') throw new Error('Invalid relationship.');
            return { id: validatePlayerId(string(row.id)), name: string(row.name), ownerName: string(row.ownerName),
              avatar: validateGroupAvatar(row.avatar),
              memberCount: integer(row.memberCount), relationship };
          });
          if (new Set(groups.map((group) => group.id)).size !== groups.length) throw new Error('Duplicate groups.');
          return { groups, nextCursor: result.nextCursor === null ? null : validatePlayerId(string(result.nextCursor)) };
        } catch (cause) { throw new DataError('The group search response is invalid.', 502, { cause }); }
      });
    },
    requestJoin(id) {
      return request(`/groups/${encodeURIComponent(id)}/join-requests/me`, 'PUT', undefined, undefined, (data) => {
        if (isObject(data) && (data.status === 'pending' || data.status === 'member' || data.status === 'declined')) return data.status;
        throw new DataError('The join request response is invalid. Retry to check its status.', 502);
      });
    },
    requests(id) {
      return request(`/groups/${encodeURIComponent(id)}/join-requests`, 'GET', undefined, undefined, (data) => {
        try {
          const requests = array(object(data).requests).map((value) => {
            const row = object(value);
            return { playerId: validatePlayerId(string(row.playerId)), displayName: string(row.displayName),
              ...(row.code === undefined ? {} : { code: validatePlayerCode(string(row.code)) }) };
          });
          if (new Set(requests.map((entry) => entry.playerId)).size !== requests.length) throw new Error('Duplicate requests.');
          return requests;
        } catch (cause) { throw new DataError('The join request list is invalid.', 502, { cause }); }
      });
    },
    change(group, command) {
      const path = `/groups/${encodeURIComponent(group.id)}`;
      switch (command.type) {
        case 'add-player': return groupRequest(`${path}/players`, 'POST', { playerId: validatePlayerReference(command.playerId) }, group.revision);
        case 'add-guest': return groupRequest(`${path}/guests`, 'POST', { name: command.name });
        case 'remove-player': return groupRequest(`${path}/players/${encodeURIComponent(command.playerId)}`, 'DELETE', undefined, group.revision);
        case 'start-game': return groupRequest(`${path}/games`, 'POST', { teamA: command.teamA, teamB: command.teamB, wager: command.wager }, group.revision);
        case 'record-result': return groupRequest(`${path}/games/${encodeURIComponent(command.gameId)}/result`, 'POST',
          { scoreA: command.scoreA, scoreB: command.scoreB }, group.revision);
        case 'delete-game': return groupRequest(`${path}/games/${encodeURIComponent(command.gameId)}`, 'DELETE', undefined, group.revision);
        case 'set-visibility': return groupRequest(`${path}/visibility`, 'POST', { isPublic: command.isPublic }, group.revision);
        case 'set-avatar': return groupRequest(`${path}/avatar`, 'POST', { avatar: validateGroupAvatar(command.avatar) }, group.revision);
        case 'set-admin': return groupRequest(`${path}/players/${encodeURIComponent(command.playerId)}/admin`, 'POST',
          { isAdmin: command.isAdmin }, group.revision);
        case 'review-request': return groupRequest(`${path}/join-requests/${encodeURIComponent(command.playerId)}`, 'POST',
          { decision: command.decision }, group.revision);
      }
    },
  };
}

export function mergeSavedGroups<T extends { readonly id: string; readonly revision: string }>(
  incoming: readonly T[], savedDuringLoad: readonly T[], removedDuringLoad: readonly string[] = [],
): readonly T[] {
  const merged = new Map(incoming.map((group) => [group.id, group]));
  for (const group of savedDuringLoad) {
    const previous = merged.get(group.id);
    if (!previous || previous.revision < group.revision) merged.set(group.id, group);
  }
  return [...merged.values()].filter((group) => !removedDuringLoad.includes(group.id));
}

export function dataErrorMessage(error: unknown): string {
  if (error instanceof DataError || error instanceof ValidationError || (error instanceof Error && error.name === 'AuthError')) return error.message;
  console.error('A saved-data operation failed unexpectedly. Request contents were not logged.');
  return 'The data operation failed. Please retry or refresh your groups.';
}
