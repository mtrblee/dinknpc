import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthError, authErrorMessage, readAuthConfig, validateCredentials, validateDisplayName, validateEmail,
  validateVerificationCode,
} from './auth.ts';

test('auth config accepts only an HTTPS origin and a public publishable key', () => {
  assert.deepEqual(readAuthConfig(' https://example.supabase.co/ ', ' sb_publishable_synthetic '), {
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_synthetic',
  });
  for (const [url, key] of [
    [undefined, undefined],
    ['', 'sb_publishable_synthetic'],
    ['https://example.supabase.co', ''],
    ['not a URL', 'sb_publishable_synthetic'],
    ['http://example.supabase.co', 'sb_publishable_synthetic'],
    ['https://user:password@example.supabase.co', 'sb_publishable_synthetic'],
    ['https://example.supabase.co/auth', 'sb_publishable_synthetic'],
    ['https://example.supabase.co?key=synthetic', 'sb_publishable_synthetic'],
    ['https://example.supabase.co#fragment', 'sb_publishable_synthetic'],
    ['https://example.supabase.co', 'sb_secret_synthetic'],
    ['https://example.supabase.co', 'eyJ-synthetic-legacy-key'],
    ['https://example.supabase.co', 'sb_publishable_'],
  ]) {
    assert.throws(() => readAuthConfig(url, key), AuthError);
  }
});

test('credentials trim email but never alter passwords, and apply signup-only minimum length', () => {
  assert.deepEqual(validateCredentials(' alex@example.test ', '  long password  ', true), {
    email: 'alex@example.test',
    password: '  long password  ',
  });
  assert.equal(validateCredentials('alex@example.test', 'legacy', false).password, 'legacy');
  assert.throws(() => validateCredentials('alex@example.test', '12345678901', true), /at least 12/);
  assert.doesNotThrow(() => validateCredentials('alex@example.test', '123456789012', true));
  assert.throws(() => validateCredentials('alex@example.test', '', false), /Enter your password/);
  for (const email of ['', ' ', 'alex', 'alex@example', 'a b@example.test', 'a@@example.test', `${'a'.repeat(250)}@example.test`]) {
    assert.throws(() => validateEmail(email), AuthError);
  }
});

test('verification validates numeric codes without converting away leading zeroes', () => {
  assert.equal(validateVerificationCode(' 001234 '), '001234');
  assert.equal(validateVerificationCode('0123456789'), '0123456789');
  for (const code of ['', '12345', '12345678901', '12 3456', '123abc', '-12345', '1e1234']) {
    assert.throws(() => validateVerificationCode(code), AuthError);
  }
});

test('account display names are trimmed and must contain visible content', () => {
  assert.equal(validateDisplayName('  Alex  '), 'Alex');
  for (const name of ['', ' ', '\n\t']) assert.throws(() => validateDisplayName(name), AuthError);
});

test('auth errors surface actionable messages without leaking provider details', (context) => {
  const logging = context.mock.method(console, 'error', () => {});
  assert.equal(authErrorMessage(new AuthError('Check your input.')), 'Check your input.');
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /email or password/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /Confirm your email/);
  assert.match(authErrorMessage({ code: 'otp_expired' }), /invalid or expired/);
  assert.match(authErrorMessage({ code: 'over_email_send_rate_limit' }), /Wait/);
  assert.match(authErrorMessage({ code: 'email_address_not_authorized' }), /SMTP/);
  assert.match(authErrorMessage({ code: 'weak_password' }), /12 characters/);
  assert.match(authErrorMessage({ code: 'session_not_found' }), /Sign out/);
  const offline = new Error('synthetic sensitive request details');
  offline.name = 'AuthRetryableFetchError';
  assert.match(authErrorMessage(offline), /internet connection/);
  assert.equal(logging.mock.callCount(), 0);

  const result = authErrorMessage(new Error('synthetic sensitive request details'));
  assert.match(result, /could not be completed/);
  assert.doesNotMatch(result, /synthetic sensitive/);
  assert.equal(logging.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(logging.mock.calls[0].arguments), /synthetic sensitive/);
});
