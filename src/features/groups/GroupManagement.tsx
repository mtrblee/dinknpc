import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GroupsApi } from '../../services/groupsApi';
import { dataErrorMessage } from '../../services/groupsApi';
import type { JoinRequest, SavedGroup } from '../../types/api';
import { Action, colors, ErrorMessage, Field, styles } from './ui';
import type { RefreshHandle } from './ui';
import { useGroupMutation } from './useGroupMutation';
import { GroupAvatar, GroupAvatarPicker } from './GroupAvatar';
import { getPlayerLabel } from '../../domain/groups';
import type { GroupLifecycleAction } from '../../types/api';

export const groupSettingsTitles = {
  settings: 'Group settings',
  requests: 'Join requests',
  visibility: 'Group visibility',
  avatar: 'Change group avatar',
  admins: 'Admins',
  transfer: 'Transfer ownership',
  delete: 'Delete group',
} as const;
export type GroupSettingsPage = keyof typeof groupSettingsTitles;

export function GroupManagement({ group, currentPlayerId, api, onUpdate, onExit, onOpenPlayers, page, onOpenPage, refreshRef }: {
  group: SavedGroup; currentPlayerId: string; api: GroupsApi; onUpdate: (group: SavedGroup) => void;
  onExit: (id: string) => void;
  onOpenPlayers: () => void;
  page: GroupSettingsPage;
  onOpenPage: (page: GroupSettingsPage) => void;
  refreshRef: Ref<RefreshHandle>;
}) {
  const [requests, setRequests] = useState<readonly JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const generation = useRef(0);
  const { busy: mutating, error, run } = useGroupMutation(group, api, onUpdate);
  const [changingOwnership, setChangingOwnership] = useState(false);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);
  const [newOwner, setNewOwner] = useState<string | null>(null);
  const [choosingOwner, setChoosingOwner] = useState(false);
  const [adminPlayer, setAdminPlayer] = useState<string | null>(null);
  const [choosingAdmin, setChoosingAdmin] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const ownershipPending = useRef(false);
  const busy = mutating || changingOwnership;
  const eligible = group.players.filter((player) => !player.isGuest && !player.isDeleted && player.id !== group.ownerId);
  const selectedOwner = eligible.find((player) => player.id === newOwner);
  const adminEligible = eligible.filter(player => player.id !== currentPlayerId);
  const selectedAdmin = adminEligible.find(player => player.id === adminPlayer);

  async function changeOwnership(action: GroupLifecycleAction) {
    if (busy || ownershipPending.current) return;
    ownershipPending.current = true;
    setChangingOwnership(true);
    setOwnershipError(null);
    try {
      await api.changeOwnership(group, action);
      onExit(group.id);
    } catch (caught) { setOwnershipError(dataErrorMessage(caught)); }
    finally { ownershipPending.current = false; setChangingOwnership(false); }
  }
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!group.canManage) {
      setRequests([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.requests(group.id);
      if (generation.current === current) setRequests(result);
    } catch (caught) {
      if (generation.current === current) setLoadError(dataErrorMessage(caught));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [api, group.id, group.canManage]);
  useImperativeHandle(refreshRef, () => ({ refresh }), [refresh]);
  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh, group.revision]);

  useEffect(() => {
    if ((!group.canManage && page !== 'settings' && page !== 'visibility') ||
      (!group.isOwner && (page === 'transfer' || page === 'delete'))) onOpenPage('settings');
  }, [group.canManage, group.isOwner, page, onOpenPage]);

  function changeVisibility() {
    Alert.alert(group.isPublic ? 'Make this group private?' : 'Make this group public?',
      group.isPublic
        ? 'It will disappear from search. Existing members and pending join requests are kept.'
        : 'Signed-in users can find its name, owner display name, and member count. Players, scores, and rankings remain members-only.',
      [{ text: 'Cancel', style: 'cancel' },
        { text: group.isPublic ? 'Make private' : 'Make public',
          onPress: () => void run({ type: 'set-visibility', isPublic: !group.isPublic }) }]);
  }
  return (
    <View style={settings.screen}>
      {page === 'settings' ? (
        <View style={settings.card}>
          <View style={settings.profile}>
            <GroupAvatar avatar={group.avatar} size={48} />
            <View style={settings.copy}>
              <Text accessibilityRole="header" style={settings.name}>{group.name}</Text>
              <Text style={settings.note}>Owned by {group.ownerName}</Text>
            </View>
          </View>
          <View>
            {group.canManage && <SettingRow title="Join requests"
              value={loading ? 'Loading...' : loadError ? 'Unavailable' : String(requests.length)}
              disabled={busy} onPress={() => onOpenPage('requests')} />}
            <SettingRow title="View players" accessibilityLabel={`View players in ${group.name}`}
              value={String(group.players.length)} disabled={busy} onPress={onOpenPlayers} />
            <SettingRow title="Group visibility" value={group.isPublic ? 'Public' : 'Private'}
              icon={group.isPublic ? '\u{1F310}' : '\u{1F512}'}
              disabled={busy} onPress={() => onOpenPage('visibility')} />
            {group.canManage && <>
              <SettingRow title="Change group avatar" disabled={busy} onPress={() => onOpenPage('avatar')} />
              <SettingRow title="Admins" value={String(group.adminIds.length)}
                disabled={busy} onPress={() => onOpenPage('admins')} />
            </>}
            {group.isOwner && <>
              <SettingRow title="Transfer ownership" disabled={busy} onPress={() => onOpenPage('transfer')} />
              <SettingRow title="Delete group" destructive disabled={busy} onPress={() => onOpenPage('delete')} />
            </>}
          </View>
        </View>
      ) : <Text style={settings.note}>{group.name}</Text>}
      <ErrorMessage message={error} />
      <ErrorMessage message={ownershipError} />
      {busy && <Text accessibilityLiveRegion="polite" style={settings.note}>Saving changes...</Text>}
      {group.canManage && (page === 'settings' || page === 'requests') && <>
        <ErrorMessage message={loadError} />
        {loadError && <Text style={settings.note}>Pull down to retry loading join requests.</Text>}
      </>}
      {!group.canManage && <Text style={settings.note}>Members can add registered players. Other group settings are managed by the owner and admins.</Text>}
      {page === 'visibility' && <View style={settings.card}>
        <Text style={settings.note}>{group.isPublic
          ? 'Visible in search to signed-in users. Players, scores, and rankings remain members-only.'
          : 'Hidden from search. Only the owner and added members can access this group.'}</Text>
        {group.canManage ? <Pressable accessibilityRole="switch" accessibilityLabel="Public visibility"
          accessibilityHint={group.isPublic ? 'Visible in search. Press to confirm making the group private.'
            : 'Hidden from search. Press to confirm making the group public.'}
          accessibilityState={{ checked: group.isPublic, disabled: busy, busy }} disabled={busy}
          onPress={changeVisibility} style={({ pressed }) => [settings.settingRow, settings.divider, (busy || pressed) && styles.dimmed]}>
          <Text style={settings.rowLabel}>Public visibility</Text>
          <Text accessible={false} allowFontScaling={false} style={settings.visibilityIcon}>{group.isPublic ? '\u{1F310}' : '\u{1F512}'}</Text>
          <Text style={settings.note}>{group.isPublic ? 'Public' : 'Private'}</Text>
        </Pressable> : <Text style={settings.name}>{group.isPublic ? 'Public' : 'Private'}</Text>}
      </View>}
      {page === 'requests' && group.canManage && <View style={settings.card}>
        {loading && <ActivityIndicator accessibilityLabel="Loading join requests" color={colors.primary} />}
        {!loading && !loadError && requests.length === 0 && <Text style={settings.note}>No pending requests.</Text>}
        {requests.map((request) => (
          <View key={request.playerId} style={settings.request}>
            <Text style={settings.label}>{request.displayName}</Text>
            <Text selectable style={settings.playerId}>{request.code ?? request.playerId}</Text>
            <View style={settings.row}>
              <View style={settings.copy}>
                <Action title="Approve" compact disabled={busy || loading}
                  onPress={() => void run({ type: 'review-request', playerId: request.playerId, decision: 'approve' })} />
              </View>
              <View style={settings.copy}>
                <Action title="Decline" compact disabled={busy || loading}
                  onPress={() => void run({ type: 'review-request', playerId: request.playerId, decision: 'decline' })} destructive />
              </View>
            </View>
          </View>
        ))}
        <Text style={settings.note}>Pull down to refresh or retry.</Text>
      </View>}
      {page === 'avatar' && group.canManage && <View style={settings.card}>
        <GroupAvatarPicker value={group.avatar} disabled={busy}
          onChange={(avatar) => void run({ type: 'set-avatar', avatar }, () => onOpenPage('settings'))} />
      </View>}
      {page === 'admins' && group.canManage && <View style={settings.card}>
        <Text style={settings.note}>The owner and admins can change other players' admin access. Only the owner can delete or transfer the group.</Text>
        {!adminEligible.length ? <Text style={settings.note}>Add another registered player in View players first.</Text> : <>
          <Pressable accessibilityRole="combobox" accessibilityLabel="Player admin access"
            accessibilityValue={{ text: selectedAdmin ? getPlayerLabel(group, selectedAdmin) : 'Select a player' }}
            accessibilityState={{ expanded: choosingAdmin, disabled: busy }} disabled={busy}
            onPress={() => setChoosingAdmin(!choosingAdmin)}
            style={({ pressed }) => [settings.select, (pressed || busy) && styles.dimmed]}>
            <Text style={[settings.label, settings.copy]}>{selectedAdmin ? getPlayerLabel(group, selectedAdmin) : 'Select a player'}</Text>
            <Text accessible={false} style={settings.arrow}>{choosingAdmin ? '\u2303' : '\u2304'}</Text>
          </Pressable>
          {choosingAdmin && <ScrollView style={settings.options} nestedScrollEnabled keyboardShouldPersistTaps="handled"
            accessibilityLabel="Eligible players for admin access">
            {adminEligible.map(player => (
              <Pressable key={player.id} accessibilityRole="radio"
                accessibilityLabel={`${getPlayerLabel(group, player)}, ${group.adminIds.includes(player.id) ? 'Admin' : 'Player'}`}
                accessibilityState={{ checked: selectedAdmin?.id === player.id, disabled: busy }} disabled={busy}
                onPress={() => { setAdminPlayer(player.id); setChoosingAdmin(false); }}
                style={({ pressed }) => [settings.option, selectedAdmin?.id === player.id && settings.active, (pressed || busy) && styles.dimmed]}>
                <Text style={settings.label}>{getPlayerLabel(group, player)}</Text>
                <Text style={settings.note}>{group.adminIds.includes(player.id) ? 'Admin' : 'Player'}</Text>
              </Pressable>
            ))}
          </ScrollView>}
          <Action title={selectedAdmin && group.adminIds.includes(selectedAdmin.id) ? 'Remove admin access' : 'Make admin'}
            compact disabled={busy || !selectedAdmin} destructive={!!selectedAdmin && group.adminIds.includes(selectedAdmin.id)}
            onPress={() => {
              if (!selectedAdmin) return;
              const isAdmin = !group.adminIds.includes(selectedAdmin.id);
              Alert.alert(isAdmin ? 'Make this player an admin?' : 'Remove admin access?',
                isAdmin ? `${getPlayerLabel(group, selectedAdmin)} will be able to manage players, games, tournaments, settings, and other admins.`
                  : `${getPlayerLabel(group, selectedAdmin)} will remain a player but lose group-management privileges.`,
                [{ text: 'Cancel', style: 'cancel' }, { text: isAdmin ? 'Make admin' : 'Remove admin',
                  style: isAdmin ? 'default' : 'destructive',
                  onPress: () => void run({ type: 'set-admin', playerId: selectedAdmin.id, isAdmin }) }]);
            }} />
        </>}
      </View>}
      {page === 'transfer' && group.isOwner && <View style={settings.card}>
        <Text style={settings.note}>Choose an active registered member. You stay a member only if already on the roster.</Text>
        {!eligible.length ? <Text style={settings.note}>Add a registered player in View players first.</Text> : (
          <>
            <Pressable accessibilityRole="combobox" accessibilityLabel="New group owner"
              accessibilityValue={{ text: selectedOwner ? getPlayerLabel(group, selectedOwner) : 'Select a member' }}
              accessibilityState={{ expanded: choosingOwner, disabled: busy }} disabled={busy}
              onPress={() => setChoosingOwner(!choosingOwner)}
              style={({ pressed }) => [settings.select, (pressed || busy) && styles.dimmed]}>
              <Text style={[settings.label, settings.copy]}>{selectedOwner ? getPlayerLabel(group, selectedOwner) : 'Select a member'}</Text>
              <Text accessible={false} style={settings.arrow}>{choosingOwner ? '\u2303' : '\u2304'}</Text>
            </Pressable>
            {choosingOwner && (
              <ScrollView style={settings.options} nestedScrollEnabled keyboardShouldPersistTaps="handled"
                accessibilityLabel="Eligible group members">
                {eligible.map((player) => (
                  <Pressable key={player.id} accessibilityRole="radio" accessibilityLabel={getPlayerLabel(group, player)}
                    accessibilityState={{ checked: selectedOwner?.id === player.id, disabled: busy }} disabled={busy}
                    onPress={() => { setNewOwner(player.id); setChoosingOwner(false); }}
                    style={({ pressed }) => [settings.option, selectedOwner?.id === player.id && settings.active,
                      (pressed || busy) && styles.dimmed]}>
                    <Text style={settings.label}>{getPlayerLabel(group, player)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        )}
        <Action title="Transfer ownership" compact disabled={busy || !selectedOwner}
          onPress={() => {
            if (!selectedOwner) return;
            Alert.alert('Transfer this group?', `Make ${getPlayerLabel(group, selectedOwner)} the owner? You cannot undo this without their help.`,
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Transfer', onPress: () => void changeOwnership({ type: 'transfer', playerId: selectedOwner.id }) }]);
          }} />
      </View>}
      {page === 'delete' && group.isOwner && <View style={settings.card}>
        <Text style={settings.note}>Permanently deletes this group, its games, tournaments, memberships, and guests for everyone. Registered accounts and other groups are not deleted.</Text>
        <Field label="Type DELETE to confirm" value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters"
          autoCorrect={false} editable={!busy} />
        <Action title="Delete this group" compact disabled={busy || confirmation !== 'DELETE'} destructive
          onPress={() => Alert.alert('Permanently delete this group?', `All of ${group.name}'s shared results will be lost. This cannot be undone.`,
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete group', style: 'destructive', onPress: () => void changeOwnership({ type: 'delete' }) }])} />
      </View>}
    </View>
  );
}

function SettingRow({ title, accessibilityLabel = title, value, icon, disabled, destructive = false, onPress }: {
  title: string; accessibilityLabel?: string; value?: string; icon?: string;
  disabled: boolean; destructive?: boolean; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens a separate page." accessibilityValue={value ? { text: value } : undefined}
      accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [settings.settingRow, settings.divider, (pressed || disabled) && styles.dimmed]}>
      <Text style={[settings.rowLabel, destructive && settings.danger]}>{title}</Text>
      {icon && <Text accessible={false} allowFontScaling={false} style={settings.visibilityIcon}>{icon}</Text>}
      {value && <Text style={settings.value}>{value}</Text>}
      <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
    </Pressable>
  );
}

const settings = StyleSheet.create({
  screen: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.foreground },
  label: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  note: { fontSize: 12, lineHeight: 17, color: colors.secondary },
  playerId: { fontSize: 10, color: colors.secondary },
  card: { padding: 14, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.surface },
  settingRow: { minHeight: 44, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.foreground },
  divider: { borderTopWidth: 1, borderTopColor: colors.softBorder },
  value: { flexShrink: 1, maxWidth: '40%', fontSize: 12, lineHeight: 17, color: colors.secondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  request: { borderTopWidth: 1, borderTopColor: colors.softBorder, paddingTop: 8, gap: 6 },
  visibilityIcon: { fontSize: 18 },
  active: { backgroundColor: colors.selected },
  arrow: { fontSize: 18, color: colors.secondary },
  select: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44, padding: 10,
    borderWidth: 1, borderColor: colors.softBorder, borderRadius: 10 },
  options: { maxHeight: 200, borderWidth: 1, borderColor: colors.softBorder, borderRadius: 10 },
  option: { minHeight: 44, padding: 10, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.softBorder },
  danger: { color: colors.error },
});
