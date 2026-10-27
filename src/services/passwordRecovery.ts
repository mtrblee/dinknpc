import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, validateEmail, validateNewPassword, validateVerificationCode } from './auth.ts';
import type { PasswordRecoveryService } from './auth.ts';

type Recovery = {
  client: SupabaseClient;
  email: string;
  userId: string | null;
  phase: 'code' | 'password' | 'finish';
};

export function createPasswordRecovery(createClient: () => SupabaseClient): PasswordRecoveryService {
  let recovery: Recovery | null = null;
  let busy = false;

  function available() {
    if (busy) throw new AuthError('Wait for the current recovery request to finish.');
  }
  function begin(email: string): Recovery {
    available();
    if (recovery?.phase === 'finish') throw new AuthError('Your password was updated. Finish signing out before starting again.');
    recovery = { client: createClient(), email, userId: null, phase: 'code' };
    return recovery;
  }
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    available();
    busy = true;
    try { return await operation(); }
    finally { busy = false; }
  }

  return {
    async request(value) {
      const state = begin(validateEmail(value));
      await run(async () => {
        const { error } = await state.client.auth.resetPasswordForEmail(state.email);
        if (error) throw error;
      });
    },
    async verify(value, code) {
      const email = validateEmail(value);
      const token = validateVerificationCode(code);
      available();
      const state = recovery?.email === email ? recovery : begin(email);
      if (state.phase !== 'code') throw new AuthError('This recovery code has already been verified. Finish recovery or start again.');
      await run(async () => {
        const { data, error } = await state.client.auth.verifyOtp({ email, token, type: 'recovery' });
        if (error) throw error;
        if (!data.user || !data.session || data.session.user.id !== data.user.id ||
            data.user.email?.toLowerCase() !== email.toLowerCase()) {
          recovery = null;
          throw new AuthError('The recovery session could not be verified. Request a new code.');
        }
        state.userId = data.user.id;
        state.phase = 'password';
      });
    },
    async setPassword(password, confirmation) {
      validateNewPassword(password);
      if (password !== confirmation) throw new AuthError('The passwords do not match.');
      available();
      const state = recovery;
      if (!state?.userId || state.phase !== 'password') throw new AuthError('Verify your recovery code before setting a new password.');
      await run(async () => {
        const { data, error } = await state.client.auth.updateUser({ password });
        if (error) throw error;
        if (!data.user || data.user.id !== state.userId) throw new AuthError('The password update could not be confirmed. Please retry.');
        state.phase = 'finish';
      });
    },
    async finish() {
      available();
      const state = recovery;
      if (!state || state.phase !== 'finish') throw new AuthError('Set a new password before finishing recovery.');
      await run(async () => {
        const { error } = await state.client.auth.signOut({ scope: 'global' });
        if (error) throw error;
        recovery = null;
      });
    },
    cancel() {
      available();
      if (recovery?.phase === 'finish') throw new AuthError('Your password was updated. Finish signing out before leaving recovery.');
      recovery = null;
    },
  };
}
