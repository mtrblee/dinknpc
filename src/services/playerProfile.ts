import { validateAvatar } from '../domain/avatars.ts';
import type { AvatarId } from '../domain/avatars.ts';
import { validateDisplayName } from './auth.ts';
import type { AuthService } from './auth.ts';
import { DataError, dataErrorMessage } from './groupsApi.ts';
import type { GroupsApi } from './groupsApi.ts';
import { validatePlayerCode } from '../domain/groups.ts';

export async function loadPlayerCode(api: GroupsApi | null, userId: string): Promise<string> {
  if (!api) throw new DataError('The data service must be configured to load your player code.');
  const player = await api.syncProfile();
  if (player.id !== userId || player.isGuest || player.isDeleted) {
    throw new DataError('The service did not return your registered account. Reopen Settings.', 502);
  }
  if (player.code === undefined) {
    throw new DataError('Player codes are not available on this server yet. An API update is required.', 502);
  }
  try { return validatePlayerCode(player.code); }
  catch (cause) { throw new DataError('The service returned an invalid player code. Please retry.', 502, { cause }); }
}

export async function savePlayerAvatar(service: AuthService, api: GroupsApi | null, userId: string, value: AvatarId) {
  return savePlayerProfile(service, api, userId, { avatar: validateAvatar(value) });
}

export async function savePlayerDisplayName(service: AuthService, api: GroupsApi | null, userId: string, value: string) {
  return savePlayerProfile(service, api, userId, { name: validateDisplayName(value) });
}

async function savePlayerProfile(
  service: AuthService, api: GroupsApi | null, userId: string, change: { name: string } | { avatar: AvatarId },
) {
  const label = 'name' in change ? 'display name' : 'avatar';
  const action = 'name' in change ? 'Save player name' : 'Save avatar';
  if (!api) throw new DataError(`The data service must be configured before updating your ${label} in groups.`);
  const session = await service.getSessionToken();
  if (session.userId !== userId) throw new DataError('The signed-in account changed. Reopen Settings.', 401);
  if ('name' in change) await service.setDisplayName(change.name);
  else await service.setAvatar(change.avatar);
  try {
    const player = await api.syncProfile();
    if (player.id !== userId || player.isGuest || player.isDeleted ||
        ('name' in change ? player.name !== change.name : player.avatar !== change.avatar)) {
      throw new DataError(`The data service has not confirmed your selected ${label}. Please retry.`, 502);
    }
    return player;
  } catch (cause) {
    throw new DataError(
      `Your ${label} was saved to your account, but group synchronization was not confirmed. Press ${action} again to retry. ${dataErrorMessage(cause)}`,
      cause instanceof DataError ? cause.status : 0, { cause },
    );
  }
}
