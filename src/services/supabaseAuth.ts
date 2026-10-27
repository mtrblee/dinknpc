import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  AuthError, validateCredentials, validateDisplayName, validateEmail, validateVerificationCode,
} from './auth.ts';
import type { AuthService, AuthUser } from './auth.ts';
import { avatarFromMetadata, validateAvatar } from '../domain/avatars.ts';
import { createPasswordRecovery } from './passwordRecovery.ts';

function account(user: User): AuthUser {
  const name: unknown = user.user_metadata?.display_name;
  return {
    id: user.id,
    email: user.email,
    displayName: typeof name === 'string' && name.trim() ? name.trim() : null,
    avatar: avatarFromMetadata(user.user_metadata?.avatar),
  };
}

export function createSupabaseAuthService(client: SupabaseClient, createIsolatedClient: () => SupabaseClient): AuthService {
  return {
    recovery: createPasswordRecovery(createIsolatedClient),
    async reauthenticate(password) {
      const current = await client.auth.getUser();
      if (current.error) throw current.error;
      if (!current.data.user?.email) throw new AuthError('Log in again before deleting your account.');
      const credentials = validateCredentials(current.data.user.email, password, false);
      const isolated = createIsolatedClient();
      const { data, error } = await isolated.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (!data.user || !data.session || data.user.id !== current.data.user.id || data.session.user.id !== current.data.user.id) {
        throw new AuthError('Your account could not be confirmed. Log in again before deleting it.');
      }
      return { userId: data.user.id, accessToken: data.session.access_token };
    },
    async getSessionToken() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new AuthError('Please log in again before accessing saved groups.');
      return { userId: data.session.user.id, accessToken: data.session.access_token };
    },
    async getCurrentUser() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;

      // Stored session data alone is not authoritative; validate it with Supabase.
      const result = await client.auth.getUser();
      if (result.error) throw result.error;
      if (!result.data.user) throw new AuthError('The account service did not return a user. Please log in again.');
      return account(result.data.user);
    },
    async signUp(email, password) {
      const credentials = validateCredentials(email, password, true);
      const { data, error } = await client.auth.signUp(credentials);
      if (error) throw error;
      if (!data.user) throw new AuthError('Signup could not be completed. Please try again.');
      return data.session ? 'signed-in' : 'confirmation-required';
    },
    async signIn(email, password) {
      const credentials = validateCredentials(email, password, false);
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (!data.session) throw new AuthError('Login did not return a session. Please try again.');
    },
    async confirmEmail(email, code) {
      const { data, error } = await client.auth.verifyOtp({
        email: validateEmail(email),
        token: validateVerificationCode(code),
        type: 'email',
      });
      if (error) throw error;
      if (!data.session) throw new AuthError('Verification did not return a session. Please try logging in.');
    },
    async resendConfirmation(email) {
      const { error } = await client.auth.resend({ type: 'signup', email: validateEmail(email) });
      if (error) throw error;
    },
    async setDisplayName(name) {
      const displayName = validateDisplayName(name);
      const { data, error } = await client.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
      if (!data.user || account(data.user).displayName !== displayName) {
        throw new AuthError('Your display name was not saved. Please try again.');
      }
    },
    async setAvatar(value) {
      const avatar = validateAvatar(value);
      const { data, error } = await client.auth.updateUser({ data: { avatar } });
      if (error) throw error;
      if (!data.user || data.user.user_metadata?.avatar !== avatar) {
        throw new AuthError('Your avatar was not saved. Please try again.');
      }
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    subscribe(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Startup is handled by getCurrentUser so an unverified cached user is never displayed.
        if (event === 'INITIAL_SESSION') return;
        listener(session ? account(session.user) : null);
      });
      return () => data.subscription.unsubscribe();
    },
    async setActive(active) {
      if (active) await client.auth.startAutoRefresh();
      else await client.auth.stopAutoRefresh();
    },
  };
}
