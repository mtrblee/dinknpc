import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AuthError, readAuthConfig } from './auth';
import type { AuthService } from './auth';
import { createSupabaseAuthService } from './supabaseAuth';
import { createPlayerDirectory } from './playerDirectory';
import type { PlayerDirectory } from './playerDirectory';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainService: 'dinknpc.auth',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function secureOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new AuthError(
      'Could not access secure session storage on this device. Unlock the device and try again. ' +
      'The session was not saved to an unprotected fallback.',
      { cause },
    );
  }
}

let service: AuthService | undefined;
let directory: PlayerDirectory | undefined;
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (client) return client;
  const config = readAuthConfig(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => secureOperation(() => SecureStore.getItemAsync(key, secureOptions)),
        setItem: (key, value) => secureOperation(() => SecureStore.setItemAsync(key, value, secureOptions)),
        removeItem: (key) => secureOperation(() => SecureStore.deleteItemAsync(key, secureOptions)),
      },
    },
  });
  return client;
}

export function getNativeAuthService(): AuthService {
  if (!service) service = createSupabaseAuthService(getClient(), () => {
    const config = readAuthConfig(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dinknpc.password-recovery' },
    });
  });
  return service;
}

export function getNativePlayerDirectory(): PlayerDirectory {
  if (!directory) directory = createPlayerDirectory(getClient());
  return directory;
}
