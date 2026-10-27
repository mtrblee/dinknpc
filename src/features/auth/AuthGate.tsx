import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { authErrorMessage } from '../../services/auth';
import type { AuthService, AuthUser } from '../../services/auth';
import { getNativeAuthService } from '../../services/nativeAuth';
import { Action, colors, ErrorMessage, styles } from '../groups/ui';
import { AuthPage, AuthScreen } from './AuthScreen';
import { PlayerProfileScreen } from './PlayerProfileScreen';

type Connection = { service: AuthService; error: null } | { service: null; error: string };
type AuthState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; user: AuthUser | null };

export type AccountControls = {
  service: AuthService;
  onSignOut: () => void;
  signingOut: boolean;
  error: string | null;
};

export function AuthGate({ children }: { children: (user: AuthUser, controls: AccountControls) => ReactNode }) {
  const [connection] = useState<Connection>(() => {
    try {
      return { service: getNativeAuthService(), error: null };
    } catch (caught) {
      return { service: null, error: authErrorMessage(caught) };
    }
  });
  const { service } = connection;
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const userId = auth.status === 'ready' ? auth.user?.id : undefined;

  useEffect(() => {
    if (!service) return;
    let live = true;
    let restoring = true;
    let signedOutDuringRestore = false;
    setAuth({ status: 'loading' });
    const unsubscribe = service.subscribe((user) => {
      if (!live) return;
      if (restoring) {
        if (!user) signedOutDuringRestore = true;
        return;
      }
      if (user) setError(null);
      setAuth({ status: 'ready', user });
    });
    void service.getCurrentUser().then((user) => {
      if (live) setAuth({ status: 'ready', user: signedOutDuringRestore ? null : user });
      restoring = false;
    }).catch((caught: unknown) => {
      restoring = false;
      if (live) setAuth({ status: 'failed', message: authErrorMessage(caught) });
    });
    return () => { live = false; unsubscribe(); };
  }, [service, retry]);

  useEffect(() => {
    if (!service || !userId) return;
    let live = true;
    function updateRefresh(active: boolean) {
      void service?.setActive(active).catch((caught: unknown) => {
        if (live) setError(authErrorMessage(caught));
      });
    }
    updateRefresh(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => updateRefresh(state === 'active'));
    return () => {
      live = false;
      subscription.remove();
      void service.setActive(false).catch(() => console.error('Could not stop authentication session refresh.'));
    };
  }, [service, userId]);

  async function signOut() {
    if (!service || signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    setError(null);
    try {
      await service.signOut();
      setAuth({ status: 'ready', user: null });
    } catch (caught) {
      setError(`Sign-out could not be fully completed. ${authErrorMessage(caught)}`);
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign out of DinkNow?',
      'This clears the local view and unsaved entries on this device. Your saved groups, players, and games stay in Azure.',
      [
        { text: 'Keep playing', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }

  if (!service) {
    return (
      <AuthPage title="Connect your account service" description="Supabase setup is required before you can log in.">
        <ErrorMessage message={connection.error} />
        <Text style={styles.body}>See the authentication setup in the project documentation. Never use a secret API key.</Text>
      </AuthPage>
    );
  }
  if (auth.status === 'loading') {
    return (
      <AuthPage title="Getting your account ready" description="Checking your saved session with Supabase.">
        <ActivityIndicator accessibilityLabel="Restoring session" size="large" color={colors.primary} />
      </AuthPage>
    );
  }
  if (auth.status === 'failed') {
    return (
      <AuthPage title="Could not restore your session" description="Your groups are not shown until the session check succeeds.">
        <ErrorMessage message={auth.message} />
        <ErrorMessage message={error} />
        <Action title="Retry" onPress={() => { setError(null); setRetry((value) => value + 1); }} disabled={signingOut} />
        <Action title="Sign out on this device" onPress={confirmSignOut} disabled={signingOut} />
      </AuthPage>
    );
  }
  if (!auth.user) return <AuthScreen service={service} externalError={error} />;
  if (!auth.user.displayName) {
    return (
      <PlayerProfileScreen
        key={auth.user.id}
        service={service}
        onSignOut={confirmSignOut}
        signingOut={signingOut}
        externalError={error}
      />
    );
  }
  const currentUser = auth.user;

  return (
    <View key={currentUser.id} style={layout.screen}>
      <StatusBar style="dark" />
      {children(currentUser, { service, onSignOut: confirmSignOut, signingOut, error })}
    </View>
  );
}

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
