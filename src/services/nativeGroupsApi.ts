import { randomUUID } from 'expo-crypto';
import { apiBaseUrl, createGroupsApi } from './groupsApi';
import { getNativeAuthService } from './nativeAuth';

export function getNativeGroupsApi(userId: string) {
  return createGroupsApi(
    apiBaseUrl(process.env.EXPO_PUBLIC_API_URL),
    userId,
    () => getNativeAuthService().getSessionToken(),
    randomUUID,
    fetch,
    __DEV__ ? (timing) => console.info('[group-load]', JSON.stringify(timing)) : undefined,
  );
}
