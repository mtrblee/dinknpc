import { validatePlayerId } from '../../src/domain/groups.ts';
import type { Player } from '../../src/types/groups.ts';
import { ApiError } from './contracts.ts';
import type { IdentityService } from './contracts.ts';
import { avatarFromMetadata } from '../../src/domain/avatars.ts';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createIdentityService(url: string, publishableKey: string, fetcher = fetch): IdentityService {
  async function call(path: string, token: string, body?: object): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, url), {
        method: body ? 'POST' : 'GET',
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(503, 'identity_unavailable', 'The account service is temporarily unavailable. Please retry.');
    }
    if (response.status === 401) throw new ApiError(401, 'unauthorized', 'Please log in again.');
    if (response.status === 403) throw new ApiError(403, 'account_ineligible', 'A verified, active account is required.');
    if (!response.ok) throw new ApiError(503, 'identity_unavailable', 'The account service could not validate this request.');
    return response.json();
  }

  async function findPlayer(id: string, token: string): Promise<Player> {
    const data = await call('/rest/v1/rpc/find_registered_player', token, { p_player_id: id });
    if (Array.isArray(data) && data.length === 0) {
      throw new ApiError(404, 'player_not_found', 'No eligible player was found. The account must be verified and have a display name.');
    }
    if (!Array.isArray(data) || data.length !== 1) throw new ApiError(502, 'invalid_identity_response', 'Player verification returned invalid data.');
    const row: unknown = data[0];
    if (!object(row) || row.id !== id || typeof row.display_name !== 'string' || !row.display_name.trim()) {
      throw new ApiError(502, 'invalid_identity_response', 'Player verification returned invalid data.');
    }
    return { id, name: row.display_name.trim(), avatar: avatarFromMetadata(row.avatar) };
  }

  return {
    async authenticate(header) {
      if (!header || !/^Bearer \S+$/i.test(header)) throw new ApiError(401, 'unauthorized', 'A login session is required.');
      const token = header.slice(7);
      const user = await call('/auth/v1/user', token);
      if (!object(user) || typeof user.id !== 'string') throw new ApiError(502, 'invalid_identity_response', 'Account validation returned invalid data.');
      if (typeof user.email_confirmed_at !== 'string' || !user.email_confirmed_at) {
        throw new ApiError(403, 'account_ineligible', 'Confirm your email before using saved groups.');
      }
      return { player: await findPlayer(validatePlayerId(user.id), token), token };
    },
    findPlayer,
  };
}
