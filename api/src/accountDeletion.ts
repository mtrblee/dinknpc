import { validatePlayerId } from '../../src/domain/groups.ts';
import { ApiError } from './contracts.ts';
import type { GroupStore } from './contracts.ts';

export interface AccountAdministrator {
  deleteAccount(id: string): Promise<void>;
}

export function createAccountAdministrator(url: string, secretKey: string, fetcher = fetch): AccountAdministrator {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) {
    throw new Error('Configure a valid Supabase HTTPS origin and a server-only secret key for account deletion.');
  }
  return {
    async deleteAccount(value) {
      const id = validatePlayerId(value);
      let response: Response;
      try {
        response = await fetcher(new URL(`/auth/v1/admin/users/${id}`, base), {
          method: 'DELETE',
          headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ should_soft_delete: false }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new ApiError(503, 'deletion_unavailable', 'The account deletion provider is unavailable. The request remains queued.');
      }
      if (response.status === 204) return;
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new ApiError(502, 'invalid_deletion_response', 'Account deletion was not confirmed. The request remains queued.'); }
      const row = typeof data === 'object' && data !== null ? data : null;
      if (response.status === 404 && row && (('code' in row && row.code === 'user_not_found') ||
          ('error_code' in row && row.error_code === 'user_not_found'))) return;
      const user = row && 'user' in row && typeof row.user === 'object' && row.user !== null ? row.user : row;
      if (response.ok && user && 'id' in user && user.id === id) return;
      throw new ApiError(503, 'deletion_unavailable', 'Account deletion was not confirmed. The request remains queued.');
    },
  };
}

export async function processAccountDeletions(
  store: Pick<GroupStore, 'pendingDeletions' | 'finishDeletion' | 'failDeletion'>,
  administrator: AccountAdministrator,
  log: (message: string) => void,
): Promise<void> {
  for (const job of await store.pendingDeletions()) {
    try {
      await administrator.deleteAccount(job.accountId);
      await store.finishDeletion(job.id, job.accountId);
    } catch (error) {
      log(`Account deletion will retry; receipt=${job.id}; code=${error instanceof ApiError ? error.code : 'persistence_failure'}`);
      await store.failDeletion(job.id);
    }
  }
}

export function requireRecentPassword(token: string, actorId: string, now = Date.now()): void {
  // The caller must first validate this token with Supabase; a refreshed iat is not password proof.
  const fail = () => new ApiError(401, 'reauthentication_required', 'Confirm your current password again before deleting your account.');
  let claims: unknown;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw fail();
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw fail(); }
  if (typeof claims !== 'object' || !claims || !('sub' in claims) || claims.sub !== actorId ||
      !('amr' in claims) || !Array.isArray(claims.amr) || !claims.amr.some((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'method' in entry && entry.method === 'password' &&
        'timestamp' in entry && typeof entry.timestamp === 'number' && Number.isSafeInteger(entry.timestamp) &&
        entry.timestamp >= Math.floor(now / 1000) - 300 && entry.timestamp <= Math.floor(now / 1000) + 30)) throw fail();
}
