import { createHash, randomUUID } from 'node:crypto';
import { validateCurrency, validatePlayerId, validatePlayerReference, ValidationError } from '../../src/domain/groups.ts';
import { DEFAULT_GROUP_AVATAR, GroupAvatarError, validateGroupAvatar } from '../../src/domain/groupAvatars.ts';
import type { GroupCommand, GroupLifecycleAction } from '../../src/types/api.ts';
import { mayChangeGroup } from '../../src/types/api.ts';
import { ApiError } from './contracts.ts';
import type { GroupStore, IdentityService } from './contracts.ts';
import type { TournamentAction } from '../../src/types/tournaments.ts';
import { requireRecentPassword } from './accountDeletion.ts';
import { parseTournamentScoring } from '../../src/domain/tournamentScoring.ts';

type RequestLike = {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError(400, 'invalid_body', 'Send a JSON object.');
  }
  return value;
}
function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_body', `${name} must be text.`);
  return value;
}
function team(body: Record<string, unknown>, name: string): readonly string[] {
  const value: unknown = body[name];
  if (!Array.isArray(value) || !value.every((id: unknown) => typeof id === 'string')) {
    throw new ApiError(400, 'invalid_body', `${name} must contain player IDs.`);
  }
  return value.map((id: string) => validatePlayerId(id));
}
async function body(request: RequestLike): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'content_type', 'Use application/json.');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 65536) throw new ApiError(413, 'body_too_large', 'The request is too large.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ApiError(400, 'invalid_json', 'The JSON request is invalid.'); }
  return record(value);
}
function uuid(value: string | null, label: string): string {
  if (!value) throw new ApiError(400, 'missing_id', `${label} is required.`);
  try { return validatePlayerId(value); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    throw new ApiError(400, 'invalid_id', `${label} must be a UUID.`);
  }
}
function revisionHeader(request: RequestLike): string {
  const revision = request.headers.get('if-match');
  if (!revision || !/^"[0-9a-f]{16}"$/.test(revision)) throw new ApiError(428, 'revision_required', 'Refresh the group before changing it.');
  return revision;
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export function createApi(store: GroupStore, identity: IdentityService, log: (message: string) => void, accountDeletionEnabled = false) {
  return async (request: RequestLike): Promise<Response> => {
    const correlation = randomUUID();
    try {
      const parts = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, '').split('/').filter(Boolean);
      if (request.method === 'GET' && parts.join('/') === 'health') return json({ status: 'ok' });
      if (request.method === 'GET' && parts.length === 2 && parts[0] === 'account-deletions') {
        return json(await store.deletionStatus(uuid(parts[1], 'Deletion receipt')));
      }
      const { player: actor, token } = await identity.authenticate(request.headers.get('authorization'));
      if (actor.isGuest || actor.isDeleted) throw new ApiError(403, 'account_required', 'An active registered account is required.');
      if (request.method === 'DELETE' && parts.join('/') === 'me') {
        if (!accountDeletionEnabled) throw new ApiError(503, 'deletion_not_configured', 'Account deletion is not configured on this server. Contact the app administrator.');
        if ((await body(request)).confirmation !== 'DELETE') throw new ApiError(400, 'confirmation_required', 'Confirm permanent account deletion.');
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        requireRecentPassword(token, actor.id);
        return json(await store.prepareAccountDeletion(actor, key), 202);
      }
      const profile = await store.syncPlayer(actor);
      if (request.method === 'GET' && parts.join('/') === 'me') return json({ player: profile });
      if (parts[0] !== 'groups') throw new ApiError(404, 'not_found', 'This endpoint does not exist.');
      if (parts.length === 2 && parts[1] === 'search' && request.method === 'GET') {
        const parameters = new URL(request.url).searchParams;
        const cursor = parameters.get('cursor');
        return json(await store.search(actor, (parameters.get('query') ?? '').trim(), cursor ? uuid(cursor, 'Cursor') : null));
      }
      if (parts.length === 1 && request.method === 'GET') {
        const view = new URL(request.url).searchParams.get('view');
        if (view !== null && view !== 'summary') throw new ApiError(400, 'invalid_view', 'Use the summary view or omit view for full groups.');
        return json({ groups: await (view === 'summary' ? store.summaries(actor) : store.list(actor)) });
      }
      if (parts.length === 1 && request.method === 'POST') {
        const input = await body(request);
        const name = text(input, 'name');
        const currency = validateCurrency(input.currency === undefined ? 'none' : input.currency);
        const avatar = validateGroupAvatar(input.avatar === undefined ? DEFAULT_GROUP_AVATAR : input.avatar);
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        const fingerprint = createHash('sha256').update(JSON.stringify(['create', name, currency, avatar])).digest('hex');
        const group = await store.create(actor, name, key, fingerprint, currency, avatar);
        return json({ group }, 201, { Location: `/api/groups/${group.id}`, ETag: `"${group.revision}"` });
      }
      const id = uuid(parts[1] ?? null, 'Group ID');
      if ((parts.length === 3 && parts[2] === 'owner' && request.method === 'POST') ||
          (parts.length === 2 && request.method === 'DELETE')) {
        const input = await body(request);
        const action: GroupLifecycleAction = request.method === 'DELETE'
          ? { type: 'delete' } : { type: 'transfer', playerId: uuid(text(input, 'playerId'), 'New owner ID') };
        if (action.type === 'delete' && input.confirmation !== 'DELETE') throw new ApiError(400, 'confirmation_required', 'Confirm permanent group deletion.');
        const revision = revisionHeader(request);
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        const fingerprint = createHash('sha256').update(JSON.stringify(['ownership', id, revision, action])).digest('hex');
        const receipt = await store.ownershipReceipt(actor, key, fingerprint);
        if (receipt) return json(receipt);
        const group = await store.get(actor, id);
        if (!group.isOwner) throw new ApiError(403, 'owner_required', 'Only the current owner can transfer or delete this group.');
        const target = action.type === 'transfer' ? await identity.findPlayer(action.playerId, token) : null;
        return json(await store.changeOwnership(actor, id, revision.slice(1, -1), action, target, key, fingerprint));
      }
      if (parts[2] === 'tournaments') {
        if (parts.length === 3 && request.method === 'GET') return json(await store.tournaments(actor, id));
        let action: TournamentAction;
        if ((parts.length === 3 || (parts.length === 4 && parts[3] === 'configured')) && request.method === 'POST') {
          const input = await body(request);
          if (parts[3] === 'configured' && input.scoring === undefined) throw new ApiError(400, 'invalid_body', 'Choose the tournament scoring rules.');
          const scoring = input.scoring === undefined ? {} : { scoring: parseTournamentScoring(input.scoring) };
          if ('wager' in input || 'wagerCents' in input || 'wagerUnits' in input) throw new ApiError(400, 'invalid_body', 'Tournament matches do not use simulated wagers.');
          if (input.style === 'fixed-round-robin' && Array.isArray(input.teams) && !('players' in input)) {
            action = { type: 'create', name: text(input, 'name'), teams: input.teams.map((pair: unknown) => team({ players: pair }, 'players')), ...scoring };
          } else if (input.style === 'rotating-partner-round-robin' && Array.isArray(input.players) && !('teams' in input)) {
            action = { type: 'create', style: 'rotating-partner-round-robin', name: text(input, 'name'),
              players: input.players.map((id: unknown) => uuid(typeof id === 'string' ? id : null, 'Player ID')), ...scoring };
          } else throw new ApiError(400, 'invalid_body', 'Choose fixed teams or rotating partners with the matching participant list.');
        } else {
          const tournamentId = uuid(parts[3] ?? null, 'Tournament ID');
          if (parts.length === 5 && parts[4] === 'playoffs' && request.method === 'POST') {
            const input = await body(request);
            if (!Array.isArray(input.seeds)) throw new ApiError(400, 'invalid_body', 'Confirm the playoff seeds.');
            const seeds = input.seeds.map((id: unknown) => {
              if (typeof id !== 'string') throw new ApiError(400, 'invalid_body', 'Seeds must be team IDs.');
              return id;
            });
            action = { type: 'start-playoffs', id: tournamentId, seeds };
          } else if (parts.length === 5 && parts[4] === 'playoffs' && request.method === 'DELETE') {
            action = { type: 'reset-playoffs', id: tournamentId };
          } else if (parts.length === 7 && parts[4] === 'matches' && parts[6] === 'result' && request.method === 'POST') {
            const input = await body(request);
            action = { type: 'score', id: tournamentId, matchId: parts[5], scoreA: text(input, 'scoreA'), scoreB: text(input, 'scoreB'),
              ...(input.gameId === undefined ? {} : { gameId: text(input, 'gameId') }) };
          } else if (parts.length === 7 && parts[4] === 'matches' && parts[6] === 'result' && request.method === 'DELETE') {
            action = { type: 'reset-result', id: tournamentId, matchId: parts[5] };
          } else throw new ApiError(405, 'method_not_allowed', 'This tournament operation is not supported.');
        }
        const revision = action.type === 'create' ? null : revisionHeader(request);
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        const visible = await store.get(actor, id);
        if (action.type !== 'score' && !visible.canManage) throw new ApiError(403, 'admin_required', 'Only the owner or an admin can manage tournaments.');
        const fingerprint = createHash('sha256').update(JSON.stringify(['tournament', id, revision, action])).digest('hex');
        const result = await store.changeTournament(actor, id, revision?.slice(1, -1) ?? null, action, key, fingerprint);
        return json(result, action.type === 'create' ? 201 : 200, { ETag: `"${result.group.revision}"` });
      }
      if (parts.length === 3 && parts[2] === 'join-requests' && request.method === 'GET') {
        return json({ requests: await store.requests(actor, id) });
      }
      if (parts.length === 4 && parts[2] === 'join-requests' && parts[3] === 'me' && request.method === 'PUT') {
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        const fingerprint = createHash('sha256').update(JSON.stringify(['request-join', id])).digest('hex');
        return json({ status: await store.requestJoin(actor, id, key, fingerprint) });
      }
      if (parts.length === 2 && request.method === 'GET') {
        const group = await store.get(actor, id);
        return json({ group }, 200, { ETag: `"${group.revision}"` });
      }
      let command: GroupCommand;
      if (parts.length === 3 && parts[2] === 'visibility' && request.method === 'POST') {
        const input = await body(request);
        if (typeof input.isPublic !== 'boolean') throw new ApiError(400, 'invalid_body', 'isPublic must be a boolean.');
        command = { type: 'set-visibility', isPublic: input.isPublic };
      } else if (parts.length === 3 && parts[2] === 'avatar' && request.method === 'POST') {
        command = { type: 'set-avatar', avatar: validateGroupAvatar((await body(request)).avatar) };
      } else if (parts.length === 4 && parts[2] === 'join-requests' && request.method === 'POST') {
        const input = await body(request);
        if (input.decision !== 'approve' && input.decision !== 'decline') throw new ApiError(400, 'invalid_body', 'Choose approve or decline.');
        command = { type: 'review-request', playerId: uuid(parts[3], 'Player ID'), decision: input.decision };
      } else if (parts.length === 3 && parts[2] === 'players' && request.method === 'POST') {
        command = { type: 'add-player', playerId: validatePlayerReference(text(await body(request), 'playerId')) };
      } else if (parts.length === 5 && parts[2] === 'players' && parts[4] === 'admin' && request.method === 'POST') {
        const input = await body(request);
        if (typeof input.isAdmin !== 'boolean') throw new ApiError(400, 'invalid_body', 'isAdmin must be a boolean.');
        command = { type: 'set-admin', playerId: uuid(parts[3], 'Player ID'), isAdmin: input.isAdmin };
      } else if (parts.length === 3 && parts[2] === 'guests' && request.method === 'POST') {
        command = { type: 'add-guest', name: text(await body(request), 'name') };
      } else if (parts.length === 4 && parts[2] === 'players' && request.method === 'DELETE') {
        command = { type: 'remove-player', playerId: uuid(parts[3], 'Player ID') };
      } else if (parts.length === 3 && parts[2] === 'games' && request.method === 'POST') {
        const input = await body(request);
        command = { type: 'start-game', teamA: team(input, 'teamA'), teamB: team(input, 'teamB'),
          wager: input.wager === undefined ? '' : text(input, 'wager') };
      } else if (parts.length === 5 && parts[2] === 'games' && parts[4] === 'result' && request.method === 'POST') {
        const input = await body(request);
        command = { type: 'record-result', gameId: parts[3], scoreA: text(input, 'scoreA'), scoreB: text(input, 'scoreB') };
      } else if (parts.length === 4 && parts[2] === 'games' && request.method === 'DELETE') {
        command = { type: 'delete-game', gameId: parts[3] };
      } else {
        throw new ApiError(405, 'method_not_allowed', 'This operation is not supported.');
      }
      const revision = command.type === 'add-guest' ? null : revisionHeader(request);
      const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
      const visible = await store.get(actor, id);
      if (!mayChangeGroup(visible, command)) throw new ApiError(403, 'admin_required', 'Only the owner or an admin can perform this action.');
      if (command.type === 'add-player' && command.playerId.length === 6) {
        command = { ...command, playerId: await store.resolvePlayerCode(actor, command.playerId) };
      }
      const target = command.type === 'add-player' || (command.type === 'review-request' && command.decision === 'approve') ||
        (command.type === 'set-admin' && command.isAdmin)
        ? await identity.findPlayer(command.playerId, token) : null;
      const fingerprint = createHash('sha256').update(JSON.stringify([id, revision, command])).digest('hex');
      const group = await store.change(actor, id, revision?.slice(1, -1) ?? null, command, target, key, fingerprint);
      return json({ group }, 200, { ETag: `"${group.revision}"` });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof GroupAvatarError) return json({ error: { code: 'validation', message: error.message } }, 400);
      if (error instanceof ApiError) {
        return json({ error: { code: error.code, message: error.message } }, error.status,
          error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
      }
      const code = isRecord(error) && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
      log(`Data request failed; correlation=${correlation}; type=${error instanceof Error ? error.name : 'unknown'}; code=${code}`);
      return json({ error: { code: 'data_unavailable', message: 'The data service is unavailable. Please retry shortly.' }, correlation }, 503);
    }
  };
}
