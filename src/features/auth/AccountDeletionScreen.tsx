import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { authErrorMessage } from '../../services/auth';
import type { AuthService } from '../../services/auth';
import { DataError, dataErrorMessage } from '../../services/groupsApi';
import type { GroupsApi } from '../../services/groupsApi';
import type { AccountDeletionStatus, GroupSummary } from '../../types/api';
import { Action, ErrorMessage, Field, styles } from '../groups/ui';
import { AuthPage } from './AuthScreen';

export function AccountDeletionScreen({ api, service, onManageGroup, onAccepted, onBusyChange }: {
  api: GroupsApi; service: AuthService; onManageGroup: (id: string) => Promise<void>;
  onAccepted: (receipt: AccountDeletionStatus) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [owned, setOwned] = useState<readonly GroupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const requestId = useRef<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    onBusyChange(busy || uncertain);
    return () => onBusyChange(false);
  }, [busy, uncertain, onBusyChange]);

  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); }
    catch (caught) { if (live.current) setError(caught instanceof DataError ? dataErrorMessage(caught) : authErrorMessage(caught)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }
  async function load() {
    const groups = await api.summaries();
    if (live.current) { setOwned(groups.filter((group) => group.isOwner)); setLoaded(true); }
  }
  useEffect(() => {
    live.current = true;
    void run(load);
    return () => { live.current = false; };
  }, [api]);

  async function removeAccount() {
    if (requestId.current) {
      try {
        onAccepted(await api.deletionStatus(requestId.current));
        return;
      } catch (caught) {
        if (!(caught instanceof DataError) || caught.status !== 404) throw caught;
        setUncertain(false);
      }
    }
    const session = await service.reauthenticate(password);
    setPassword('');
    requestId.current ??= randomUUID();
    setUncertain(true);
    try {
      const receipt = await api.deleteAccount(session, requestId.current);
      onAccepted(receipt);
    } catch (caught) {
      if (caught instanceof DataError && caught.status >= 400 && caught.status < 500 && caught.status !== 429) {
        setUncertain(false);
        if (caught.status === 409) setLoaded(false);
      }
      throw caught;
    }
  }
  return (
    <AuthPage title="Delete your account" description="Account deletion is permanent. Resolve groups you own before continuing.">
      <Text style={styles.body}>Transfer each owned group to a registered member, or delete the group and all its results.</Text>
      {owned.map((group) => <Action key={group.id} title={`Manage ${group.name}`} disabled={busy || uncertain}
        onPress={() => void run(() => onManageGroup(group.id))} />)}
      {loaded && owned.length === 0 && <Text style={styles.body}>You do not own any groups that need to be resolved.</Text>}
      {!loaded && <Action title={busy ? 'Checking owned groups...' : 'Retry checking owned groups'} disabled={busy} onPress={() => void run(load)} />}
      <Text style={styles.secondary}>
        In joined or transferred groups, shared games and scores stay under an anonymous Deleted player with a new identity per group.
        That participant cannot join new games or tournaments. Existing tournaments can finish with their saved participants.
        Your profile, memberships, pending requests, and Supabase account will be removed.
      </Text>
      <Text style={styles.secondary}>The server blocks data access when it accepts the request. Authentication deletion is processed in the background and retried if the account service is unavailable.</Text>
      <Field label="Current password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
        autoCorrect={false} autoComplete="current-password" textContentType="password" editable={!busy} />
      <Field label="Type DELETE to confirm" value={confirmation} onChangeText={setConfirmation}
        autoCapitalize="characters" autoCorrect={false} editable={!busy && !uncertain} />
      <ErrorMessage message={error} />
      {uncertain && <Text style={styles.body}>The request may already have been accepted. Check its status before leaving; retrying uses the same receipt. Enter your password again only if no accepted request is found.</Text>}
      <Action title={busy ? 'Please wait...' : uncertain ? 'Check deletion request' : 'Delete my account'} destructive
        disabled={busy || !loaded || owned.length > 0 || confirmation !== 'DELETE'}
        onPress={() => {
          if (uncertain) { void run(removeAccount); return; }
          Alert.alert('Permanently delete your account?', 'You cannot cancel an accepted request. Shared results will remain anonymous; your account cannot be restored.',
            [{ text: 'Keep account', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => void run(removeAccount) }]);
        }} />
    </AuthPage>
  );
}

export function AccountDeletionStatusScreen({ initial, api, service, onClose }: {
  initial: AccountDeletionStatus; api: GroupsApi; service: AuthService; onClose: () => void;
}) {
  const [receipt, setReceipt] = useState(initial);
  const [cleared, setCleared] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const clearPending = useRef(false);
  const checkPending = useRef(false);
  const live = useRef(true);
  async function clearSession() {
    if (clearPending.current) return;
    clearPending.current = true;
    setClearing(true);
    setSessionError(null);
    try { await service.signOut(); if (live.current) setCleared(true); }
    catch (caught) { if (live.current) setSessionError(authErrorMessage(caught)); }
    finally { clearPending.current = false; if (live.current) setClearing(false); }
  }
  async function check() {
    if (checkPending.current) return;
    checkPending.current = true;
    setChecking(true);
    setStatusError(null);
    try { const updated = await api.deletionStatus(initial.id); if (live.current) setReceipt(updated); }
    catch (caught) { if (live.current) setStatusError(dataErrorMessage(caught)); }
    finally { checkPending.current = false; if (live.current) setChecking(false); }
  }
  useEffect(() => {
    live.current = true;
    void clearSession();
    void check();
    return () => { live.current = false; };
  }, [api, service, initial.id]);
  return (
    <AuthPage title={receipt.status === 'completed' ? 'Account deleted' : 'Deletion requested'}
      description={receipt.status === 'completed' ? 'Your account has been deleted. Shared results remain anonymous.'
        : 'Your data access is blocked and your shared results are anonymous. The server is completing account deletion.'}>
      {receipt.retrying && <Text style={styles.body}>Deletion could not finish yet. Your request remains queued and the server will retry automatically.</Text>}
      <Text style={styles.secondary}>Closing this screen does not cancel the request. Background processing requires the configured backend to be available.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Deletion receipt</Text>
        <Text selectable style={styles.secondary}>{receipt.id}</Text>
        <Text style={styles.secondary}>Keep this receipt for support. It contains no account or player details.</Text>
      </View>
      <ErrorMessage message={statusError} />
      <Action title={checking ? 'Checking...' : 'Check deletion status'} onPress={() => void check()} disabled={checking} />
      <ErrorMessage message={sessionError} />
      {!cleared && <Action title={clearing ? 'Clearing this device...' : 'Retry clearing this device session'}
        onPress={() => void clearSession()} disabled={clearing} />}
      <Action title="Return to login" onPress={onClose} disabled={!cleared || clearing} />
    </AuthPage>
  );
}
