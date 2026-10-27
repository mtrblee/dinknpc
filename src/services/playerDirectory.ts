import type { SupabaseClient } from '@supabase/supabase-js';
import { validatePlayerId } from '../domain/groups.ts';
import type { Player } from '../types/groups.ts';
import { avatarFromMetadata } from '../domain/avatars.ts';

export interface PlayerDirectory {
  findPlayer(id: string): Promise<Player>;
}

export class PlayerLookupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlayerLookupError';
  }
}

export function createPlayerDirectory(client: Pick<SupabaseClient, 'rpc'>): PlayerDirectory {
  return {
    async findPlayer(value) {
      const id = validatePlayerId(value);
      let response;
      try {
        response = await client.rpc('find_registered_player', { p_player_id: id });
      } catch (cause) {
        throw new PlayerLookupError('Could not reach the player lookup service. Check your connection and try again.', { cause });
      }
      if (response.error) {
        if (response.error.code === 'PGRST202') {
          throw new PlayerLookupError('Player lookup is not configured. Apply the registered-player SQL setup in Supabase.');
        }
        if (response.error.code === '42501') {
          throw new PlayerLookupError('Player lookup requires a signed-in account with a verified email.');
        }
        throw new PlayerLookupError('Player lookup failed. Check your connection and try again.', { cause: response.error });
      }
      const rows: unknown = response.data;
      if (Array.isArray(rows) && rows.length === 0) {
        throw new PlayerLookupError('No eligible player was found. Check the ID and ask the player to verify their email and set a display name.');
      }
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new PlayerLookupError('The player lookup returned an invalid response. No player was added.');
      }
      const row: unknown = rows[0];
      if (typeof row !== 'object' || row === null || !('id' in row) || row.id !== id ||
          !('display_name' in row) || typeof row.display_name !== 'string' || !row.display_name.trim()) {
        throw new PlayerLookupError('The player lookup returned an invalid player. No player was added.');
      }
      return { id, name: row.display_name.trim(), avatar: avatarFromMetadata('avatar' in row ? row.avatar : undefined) };
    },
  };
}
