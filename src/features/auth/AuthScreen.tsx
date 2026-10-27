import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthError, authErrorMessage } from '../../services/auth';
import type { AuthService, PasswordRecoveryService } from '../../services/auth';
import { Action, BackButton, colors, ErrorMessage, Field, styles } from '../groups/ui';

export function AuthPage({
  title, description, children, onBack, backDisabled = false,
}: { title: string; description: string; children: ReactNode; onBack?: () => void; backDisabled?: boolean }) {
  return (
    <SafeAreaView style={layout.screen}>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={layout.screen}
    >
      <StatusBar style="dark" />
      {onBack && <View style={layout.toolbar}><BackButton onPress={onBack} disabled={backDisabled} /></View>}
      <ScrollView
        contentContainerStyle={layout.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={layout.brand}>DINKNOW</Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.body}>{description}</Text>
        <View style={styles.card}>{children}</View>
        <Text style={styles.secondary}>
          Accounts are managed by Supabase. Groups, players, and games are saved in Azure
          {' '}and remain after sign-out or app restart. Money is simulated only.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthScreen({
  service, externalError,
}: { service: AuthService; externalError: string | null }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'verify' | 'recover'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const verificationOrigin = useRef<'login' | 'signup'>('login');

  function changeMode(next: typeof mode) {
    if (next === 'verify' && (mode === 'login' || mode === 'signup')) verificationOrigin.current = mode;
    setMode(next);
    setPassword('');
    setConfirmation('');
    setCode('');
    setError(null);
    setNotice(null);
  }

  function back() {
    if (submitting.current) return;
    changeMode(mode === 'verify' ? verificationOrigin.current : 'login');
  }

  useEffect(() => {
    if (mode === 'login' || mode === 'recover') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [mode]);

  async function run(operation: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function submit() {
    void run(async () => {
      if (mode === 'verify') {
        await service.confirmEmail(email, code);
      } else if (mode === 'login') {
        await service.signIn(email, password);
        setPassword('');
      } else if (mode === 'signup') {
        if (password !== confirmation) throw new AuthError('The passwords do not match.');
        const result = await service.signUp(email, password);
        setPassword('');
        setConfirmation('');
        if (result === 'confirmation-required') {
          changeMode('verify');
          setNotice('If this address can be registered, a verification code will arrive by email. Check your spam folder too.');
        }
      }
    });
  }

  if (mode === 'recover') {
    return <PasswordRecovery service={service.recovery} initialEmail={email}
      onCancel={() => changeMode('login')}
      onComplete={(address) => {
        changeMode('login');
        setEmail(address);
        setNotice('Password changed. Log in with your new password. Other sessions may remain active until their access tokens expire.');
      }} />;
  }

  return (
    <AuthPage
      title={mode === 'login' ? 'Welcome to the court' : mode === 'signup' ? 'Create your account' : 'Check your inbox'}
      description={mode === 'verify'
        ? 'Enter your email and the code from your signup email to confirm your account.'
        : 'Log in to track your next game with your pickleball group.'}
      onBack={mode === 'login' ? undefined : back}
      backDisabled={busy}
    >
      <Field
        label="Email"
        value={email}
        onChangeText={(value) => { setEmail(value); setCode(''); }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        editable={!busy}
      />
      {mode === 'verify' ? (
        <Field
          label="Verification code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={10}
          editable={!busy}
        />
      ) : (
        <>
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            editable={!busy}
          />
          {mode === 'signup' && (
            <>
              <Text style={styles.secondary}>Use at least 12 characters and a password unique to this account.</Text>
              <Field
                label="Confirm password"
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!busy}
              />
              <Text style={styles.secondary}>You will need to confirm your email before logging in.</Text>
            </>
          )}
        </>
      )}
      <ErrorMessage message={error ?? externalError} />
      {notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
      <Action
        title={busy ? 'Please wait...' : mode === 'verify' ? 'Confirm email and log in' : mode === 'signup' ? 'Create account' : 'Log in'}
        onPress={submit}
        disabled={busy}
        selected
      />
      {mode === 'verify' && (
        <Action
          title="Resend verification code"
          disabled={busy}
          onPress={() => void run(async () => {
            await service.resendConfirmation(email);
            setNotice('If this account needs confirmation, a new code will arrive by email. Delivery and resend rate limits apply.');
          })}
        />
      )}
      {mode === 'login' && (
        <>
          <Action title="Forgot password?" onPress={() => changeMode('recover')} disabled={busy} />
          <Action title="New here? Create an account" onPress={() => changeMode('signup')} disabled={busy} />
          <Action title="Confirm email" onPress={() => changeMode('verify')} disabled={busy} />
        </>
      )}
    </AuthPage>
  );
}

function PasswordRecovery({ service, initialEmail, onCancel, onComplete }: {
  service: PasswordRecoveryService; initialEmail: string; onCancel: () => void; onComplete: (email: string) => void;
}) {
  const [phase, setPhase] = useState<'email' | 'code' | 'password' | 'finish'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function back() {
    if (submitting.current || phase === 'finish') return;
    try { service.cancel(); onCancel(); }
    catch (caught) { setError(authErrorMessage(caught)); }
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [phase]);

  async function run(operation: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await operation(); }
    catch (caught) { setError(authErrorMessage(caught)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function requestCode() {
    await service.request(email);
    setCode('');
    setPhase('code');
    setNotice('If this address has an account, a recovery code will arrive by email. Check your spam folder. Delivery and resend rate limits apply.');
  }
  async function finish() {
    await service.finish();
    onComplete(email.trim());
  }
  function submit() {
    void run(async () => {
      if (phase === 'email') await requestCode();
      else if (phase === 'code') {
        await service.verify(email, code);
        setCode('');
        setPhase('password');
      } else if (phase === 'password') {
        await service.setPassword(password, confirmation);
        setPassword('');
        setConfirmation('');
        setPhase('finish');
        await finish();
      } else await finish();
    });
  }
  return (
    <AuthPage title="Reset your password" onBack={back} backDisabled={busy || phase === 'finish'}
      description={phase === 'finish' ? 'Your password was updated. Finish signing out existing sessions, then log in again.'
        : 'Verify an emailed recovery code, then choose a new password. Recovery does not open your groups.'}>
      {(phase === 'email' || phase === 'code') && (
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
          editable={!busy && phase === 'email'} />
      )}
      {phase === 'code' && (
        <Field label="Recovery code" value={code} onChangeText={setCode} keyboardType="number-pad"
          autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} editable={!busy} />
      )}
      {phase === 'password' && (
        <>
          <Text style={styles.secondary}>Use at least 12 characters and a password unique to this account.</Text>
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry
            autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} />
          <Field label="Confirm new password" value={confirmation} onChangeText={setConfirmation} secureTextEntry
            autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} />
        </>
      )}
      <ErrorMessage message={error} />
      {notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
      <Action title={busy ? 'Please wait...' : phase === 'email' ? 'Send recovery code' : phase === 'code' ? 'Verify recovery code'
        : phase === 'password' ? 'Save new password' : 'Finish sign-out'} onPress={submit} disabled={busy} selected />
      {phase === 'email' && <Action title="I already have a recovery code" disabled={busy} onPress={() => setPhase('code')} />}
      {phase === 'code' && <Action title="Resend recovery code" disabled={busy} onPress={() => void run(requestCode)} />}
      {phase === 'code' && <Action title="Change email" disabled={busy} onPress={() => void run(async () => {
        service.cancel(); setCode(''); setPhase('email');
      })} />}
      {phase === 'password' && <Action title="Request a new code" disabled={busy} onPress={() => void run(requestCode)} />}
    </AuthPage>
  );
}

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  toolbar: { paddingHorizontal: 20, paddingTop: 8 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 20,
  },
  brand: { color: colors.primary, fontSize: 16, fontWeight: '800', letterSpacing: 3 },
});
