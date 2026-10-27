import { AvatarError } from '../domain/avatars.ts';
import type { AvatarId } from '../domain/avatars.ts';

export type AuthUser = {
  readonly id: string;
  readonly email?: string;
  readonly displayName: string | null;
  readonly avatar: AvatarId;
};

export interface AuthService {
  readonly recovery: PasswordRecoveryService;
  getCurrentUser(): Promise<AuthUser | null>;
  getSessionToken(): Promise<{ userId: string; accessToken: string }>;
  reauthenticate(password: string): Promise<{ userId: string; accessToken: string }>;
  signUp(email: string, password: string): Promise<'confirmation-required' | 'signed-in'>;
  signIn(email: string, password: string): Promise<void>;
  confirmEmail(email: string, code: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  setDisplayName(name: string): Promise<void>;
  setAvatar(avatar: AvatarId): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  setActive(active: boolean): Promise<void>;
}

export interface PasswordRecoveryService {
  request(email: string): Promise<void>;
  verify(email: string, code: string): Promise<void>;
  setPassword(password: string, confirmation: string): Promise<void>;
  finish(): Promise<void>;
  cancel(): void;
}

export class AuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export function readAuthConfig(url: string | undefined, key: string | undefined) {
  if (!url?.trim() || !key?.trim()) {
    throw new AuthError(
      'Authentication is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env, then restart Expo.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch (cause) {
    throw new AuthError('The Supabase project URL is invalid. Check .env and restart Expo.', { cause });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new AuthError('Use the HTTPS Supabase project URL without credentials, a path, or a query.');
  }
  const publishableKey = key.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new AuthError('Use a Supabase publishable key. Secret and service_role keys must never be in the app.');
  }
  return { url: parsed.origin, publishableKey };
}

export function validateEmail(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('Enter a valid email address.');
  }
  return email;
}

export function validateDisplayName(value: string): string {
  const name = value.trim();
  if (!name) throw new AuthError('Enter a display name.');
  return name;
}

export function validateCredentials(email: string, password: string, signingUp: boolean) {
  const normalizedEmail = validateEmail(email);
  if (!password) throw new AuthError('Enter your password.');
  if (signingUp) validateNewPassword(password);
  return { email: normalizedEmail, password };
}

export function validateNewPassword(password: string): void {
  if (password.length < 12) throw new AuthError('Choose a password with at least 12 characters.');
}

export function validateVerificationCode(value: string): string {
  const code = value.trim();
  if (!/^\d{6,10}$/.test(code)) {
    throw new AuthError('Enter the verification code from your email (6 to 10 digits).');
  }
  return code;
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError || error instanceof AvatarError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'invalid_credentials':
      return 'The email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Confirm your email first. Choose "Confirm email" to enter or resend your code.';
    case 'otp_expired':
    case 'otp_disabled':
      return 'That verification code is invalid or expired. Request a new code and try again.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit_by_address':
      return 'Too many attempts. Wait before trying again. Email delivery has its own rate limit.';
    case 'email_address_not_authorized':
      return 'Email delivery is limited to Supabase project-team addresses until a custom SMTP provider is configured.';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'Check your email and the information you entered, then try again.';
    case 'weak_password':
      return 'Choose a stronger password with at least 12 characters that you do not use elsewhere.';
    case 'same_password':
      return 'Choose a new password different from your current password.';
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return 'Request a new recovery code and verify it before changing your password.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Unable to create this account. If you already registered, try logging in or confirming your email.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email signup is disabled for this project. Ask the app administrator to enable it.';
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return 'Your session is no longer valid. Sign out on this device, then log in again.';
  }
  if (error instanceof Error && error.name === 'AuthRetryableFetchError') {
    return 'Could not reach the account service. Check your internet connection and try again.';
  }
  console.error('An unexpected authentication or secure-storage operation failed. Credentials were not logged.');
  return 'The account request could not be completed. Check your connection and try again.';
}
