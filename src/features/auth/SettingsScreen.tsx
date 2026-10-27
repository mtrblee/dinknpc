import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import type { AuthService, AuthUser } from '../../services/auth';
import { Action, BackButton, colors, ErrorMessage, PlayerAvatar, styles } from '../groups/ui';
import { PlayerProfileScreen } from './PlayerProfileScreen';
import { AvatarPickerScreen } from './AvatarPickerScreen';
import type { AvatarId } from '../../domain/avatars';
import { AccountDeletionScreen } from './AccountDeletionScreen';
import type { GroupsApi } from '../../services/groupsApi';
import { dataErrorMessage } from '../../services/groupsApi';
import { loadPlayerCode } from '../../services/playerProfile';
import type { AccountDeletionStatus } from '../../types/api';

const copyError = 'Could not copy your player code. Press and hold the displayed code to copy it manually.';
const profileActions = [
  { title: 'Change display name', page: 'name' },
  { title: 'Change avatar', page: 'avatar' },
] as const;

export function SettingsScreen({
  user, service, onClose, onSignOut, signingOut, externalError, onBusyChange, onSaveAvatar, onSaveDisplayName, api, onManageGroup, onDeletionAccepted,
}: {
  user: AuthUser;
  service: AuthService;
  onClose: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  externalError: string | null;
  onBusyChange: (busy: boolean) => void;
  onSaveAvatar: (avatar: AvatarId) => Promise<void>;
  onSaveDisplayName: (name: string) => Promise<void>;
  api: GroupsApi | null;
  onManageGroup: (id: string) => Promise<void>;
  onDeletionAccepted: (receipt: AccountDeletionStatus) => void;
}) {
  const [page, setPage] = useState<'settings' | 'name' | 'avatar' | 'delete'>('settings');
  const [copying, setCopying] = useState(false);
  const [playerCode, setPlayerCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(true);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeAttempt, setCodeAttempt] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyingRef = useRef(false);
  const savingProfileRef = useRef(false);
  const reportProfileBusy = useCallback((value: boolean) => {
    savingProfileRef.current = value;
    setSavingProfile(value);
  }, []);
  const busy = copying || savingProfile || signingOut;

  useEffect(() => {
    let active = true;
    setPlayerCode(null);
    setCodeError(null);
    setLoadingCode(true);
    void loadPlayerCode(api, user.id).then(code => {
      if (active) setPlayerCode(code);
    }).catch(cause => {
      if (active) setCodeError(dataErrorMessage(cause));
    }).finally(() => {
      if (active) setLoadingCode(false);
    });
    return () => { active = false; };
  }, [api, user.id, codeAttempt]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function back() {
    if (copyingRef.current || savingProfileRef.current || signingOut) return;
    if (page !== 'settings') setPage('settings');
    else onClose();
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [page, signingOut, onClose]);

  async function copyPlayerCode() {
    if (copyingRef.current || !playerCode || loadingCode || busy) return;
    copyingRef.current = true;
    setCopying(true);
    setError(null);
    setNotice(null);
    let copied: boolean;
    try {
      copied = await Clipboard.setStringAsync(playerCode);
    } catch {
      setError(copyError);
      return;
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
    if (!copied) {
      setError(copyError);
      return;
    }
    setNotice('Player code copied.');
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility('Player code copied.');
  }

  return (
      <View style={layout.screen}>
        <View style={layout.frame}>
          <View style={layout.toolbar}>
            <BackButton onPress={back} disabled={busy} />
            {page === 'settings' && <Text accessibilityRole="header" style={layout.title}>Settings</Text>}
          </View>
          {page === 'name' ? (
            <PlayerProfileScreen
              service={service}
              initialName={user.displayName ?? ''}
              onSignOut={onSignOut}
              signingOut={signingOut}
              externalError={externalError}
              onCancel={back}
              onSave={onSaveDisplayName}
              onSaved={() => { setPage('settings'); setNotice('Display name updated in your groups and game history.'); }}
              onBusyChange={reportProfileBusy}
            />
          ) : page === 'avatar' ? (
            <AvatarPickerScreen initialAvatar={user.avatar} onSave={onSaveAvatar} signingOut={signingOut}
              onCancel={back} onSaved={() => { setPage('settings'); setNotice('Avatar updated in your groups and game history.'); }}
              onBusyChange={reportProfileBusy} />
          ) : page === 'delete' && api ? (
            <AccountDeletionScreen api={api} service={service} onManageGroup={onManageGroup} onAccepted={onDeletionAccepted}
              onBusyChange={reportProfileBusy} />
          ) : (
            <ScrollView contentContainerStyle={layout.content}>
              <View style={layout.card}>
                <View style={layout.profile}>
                  <PlayerAvatar avatar={user.avatar} size={48} />
                  <View style={layout.profileCopy}>
                    <Text style={layout.name}>{user.displayName}</Text>
                    {user.email && <Text style={layout.caption}>{user.email}</Text>}
                  </View>
                </View>
                <View>
                  {profileActions.map(action => (
                    <Pressable key={action.page} accessibilityRole="button" accessibilityLabel={action.title}
                      accessibilityState={{ disabled: busy }} disabled={busy}
                      onPress={() => { setNotice(null); setError(null); setPage(action.page); }}
                      style={({ pressed }) => [layout.row, layout.divider, (pressed || busy) && styles.dimmed]}>
                      <Text style={layout.rowLabel}>{action.title}</Text>
                      <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={layout.card}>
                <Text accessibilityRole="header" style={layout.sectionLabel}>Player code</Text>
                <View style={layout.codeRow}>
                  <View style={layout.codeValue}>
                    {loadingCode && <Text accessibilityLiveRegion="polite" style={layout.caption}>Loading player code...</Text>}
                    {playerCode && <Text selectable style={layout.playerCode} accessibilityLabel={`Your player code: ${playerCode}`}>
                      {playerCode}
                    </Text>}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={copying ? 'Copying player code' : 'Copy player code'}
                    accessibilityState={{ disabled: busy || loadingCode || !playerCode, busy: copying }}
                    disabled={busy || loadingCode || !playerCode} onPress={() => void copyPlayerCode()}
                    style={({ pressed }) => [layout.copyButton, (pressed || busy || loadingCode || !playerCode) && styles.dimmed]}>
                    <Text style={layout.copyLabel}>{copying ? 'Copying...' : 'Copy'}</Text>
                  </Pressable>
                </View>
                <Text style={layout.caption}>Share to join a group. Not a password.</Text>
                <ErrorMessage message={codeError} />
                {codeError && <Action title="Retry player code" compact onPress={() => setCodeAttempt(value => value + 1)} disabled={busy || loadingCode} />}
              </View>
              {notice && <Text accessibilityLiveRegion="polite" style={layout.notice}>{notice}</Text>}
              <ErrorMessage message={error ?? externalError} />
              <View style={layout.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel={signingOut ? 'Signing out...' : 'Sign out'}
                  accessibilityState={{ disabled: busy }} disabled={busy} onPress={onSignOut}
                  style={({ pressed }) => [layout.row, (pressed || busy) && styles.dimmed]}>
                  <Text style={layout.rowLabel}>{signingOut ? 'Signing out...' : 'Sign out'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Delete account"
                  accessibilityHint="Opens account deletion review and confirmation."
                  accessibilityState={{ disabled: busy || !api }} disabled={busy || !api} onPress={() => setPage('delete')}
                  style={({ pressed }) => [layout.row, layout.divider, (pressed || busy || !api) && styles.dimmed]}>
                  <Text style={[layout.rowLabel, styles.error]}>Delete account</Text>
                  <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
                </Pressable>
              </View>
              {!api && <Text style={layout.caption}>Account deletion requires the saved-data service to be configured.</Text>}
              <Text style={layout.disclosure}>
                Money and Boba amounts are simulated tracking only. No payments, deposits, transfers, or settlement.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
  );
}

const layout = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  frame: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  toolbar: { paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  content: { padding: 16, paddingTop: 8, paddingBottom: 24, gap: 12 },
  card: { padding: 14, gap: 10, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.secondary },
  row: { minHeight: 44, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.foreground },
  divider: { borderTopWidth: 1, borderTopColor: colors.softBorder },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: colors.secondary },
  codeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  codeValue: { flexGrow: 1, minWidth: 116 },
  playerCode: {
    color: colors.foreground, fontSize: 22, lineHeight: 30, letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyButton: { minHeight: 44, minWidth: 68, paddingHorizontal: 14, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.selected },
  copyLabel: { fontSize: 13, fontWeight: '600', color: colors.primary },
  notice: { fontSize: 12, lineHeight: 17, color: colors.winner },
  actions: { paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder },
  disclosure: { fontSize: 11, lineHeight: 16, color: colors.secondary },
});
