import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupsApi } from '../../services/groupsApi';
import { dataErrorMessage } from '../../services/groupsApi';
import type { PublicGroup } from '../../types/api';
import { Action, colors, ErrorMessage, Field, styles } from './ui';
import type { RefreshHandle } from './ui';
import { GroupAvatar } from './GroupAvatar';

export function GroupSearchScreen({ api, active, onOpen, refreshRef }: {
  api: GroupsApi; active: boolean; onOpen: (id: string) => Promise<void>;
  refreshRef: Ref<RefreshHandle>;
}) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [groups, setGroups] = useState<readonly PublicGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const queryRef = useRef('');
  const search = useCallback(async (term: string, next: string | null = null) => {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.search(term, next);
      if (generation.current !== current) return;
      setGroups((previous) => next
        ? [...new Map([...previous, ...result.groups].map((group) => [group.id, group])).values()]
        : result.groups);
      setCursor(result.nextCursor);
      setSearched(term);
      setLoaded(true);
    } catch (caught) {
      if (generation.current === current) setError(dataErrorMessage(caught));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }, [api]);
  useImperativeHandle(refreshRef, () => ({ refresh: () => search(queryRef.current.trim()) }), [search]);
  useEffect(() => { if (active) void search(queryRef.current.trim()); }, [active, search]);
  useEffect(() => () => { generation.current += 1; }, []);

  async function choose(group: PublicGroup) {
    if (pending.current || group.relationship === 'pending') return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const current = generation.current;
    try {
      if (group.relationship === 'member') await onOpen(group.id);
      else {
        const status = await api.requestJoin(group.id);
        if (generation.current !== current) return;
        setGroups((previous) => previous.map((entry) => entry.id === group.id ? { ...entry, relationship: status } : entry));
        setNotice(status === 'member' ? 'You are already a member. Open the group to continue.'
          : status === 'declined' ? 'The owner or an admin declined this request. You can request again.'
          : 'Request sent. The owner or an admin will review it. Pull down to check its status.');
      }
    } catch (caught) {
      if (generation.current === current) setError(dataErrorMessage(caught));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }
  return (
    <View style={tiles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Find a group</Text>
      <Text style={styles.secondary}>Tap a tile to open a joined group or request to join. Owners approve requests. Pull down to refresh or retry.</Text>
      <Field label="Search group name" value={query} onChangeText={(value) => { queryRef.current = value; setQuery(value); }} editable={!busy} returnKeyType="search"
        onSubmitEditing={() => void search(query.trim())} />
      <Action title={busy ? 'Please wait...' : 'Search'} onPress={() => void search(query.trim())} disabled={busy} />
      <ErrorMessage message={error} />
      {notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
      {loaded && !busy && !error && groups.length === 0 && <Text style={styles.body}>No public groups match this search.</Text>}
      <View style={tiles.grid}>
        {groups.map((group) => {
          const isMember = group.relationship === 'member';
          const isPending = group.relationship === 'pending';
          const isDeclined = group.relationship === 'declined';
          const status = isMember ? 'Joined' : isPending ? 'Pending' : isDeclined ? 'Declined' : 'Public';
          const action = isMember ? 'Tap to open' : isPending ? 'Awaiting approval' : isDeclined ? 'Request again' : 'Request to join';
          const playerCount = `${group.memberCount} ${group.memberCount === 1 ? 'player' : 'players'}`;
          return (
            <View key={group.id} style={tiles.cell}>
              <Pressable accessibilityRole="button"
                accessibilityLabel={`${group.name}. Created by ${group.ownerName}. ${playerCount}. ${status}. ${action}.`}
                accessibilityHint={isMember ? 'Opens this group.' : isPending ? 'Waiting for the owner or an admin to approve your join request.'
                  : 'Sends a join request. The owner or an admin must approve before you can open the group.'}
                accessibilityState={{ disabled: busy || isPending }} disabled={busy || isPending}
                onPress={() => void choose(group)}
                style={({ pressed }) => [tiles.card, isPending && tiles.pendingCard, (pressed || busy) && styles.dimmed]}>
                <View style={tiles.top}>
                  <View accessible={false} importantForAccessibility="no-hide-descendants">
                    <GroupAvatar avatar={group.avatar} size={30} />
                  </View>
                  <Text style={[tiles.status, isMember && tiles.joinedStatus, isPending && tiles.pendingStatus]}>{status}</Text>
                </View>
                <View style={tiles.identity}>
                  <Text style={tiles.name} numberOfLines={2}>{group.name}</Text>
                  <Text style={tiles.caption} numberOfLines={2}>Created by {group.ownerName}</Text>
                  <Text style={tiles.caption}>{playerCount}</Text>
                </View>
                <View style={tiles.footer}>
                  <Text style={[tiles.action, isPending && tiles.waiting]}>{action}</Text>
                  {!isPending && <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />}
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      {cursor && <Action title="Load more groups" onPress={() => void search(searched, cursor)} disabled={busy} />}
    </View>
  );
}

const tiles = StyleSheet.create({
  screen: { gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginVertical: -5 },
  cell: { width: '50%', padding: 5 },
  card: { flex: 1, minWidth: 0, minHeight: 162, padding: 12, gap: 10, borderRadius: 18,
    borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.surface },
  pendingCard: { backgroundColor: colors.rowTint },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  status: { flexShrink: 1, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8,
    color: colors.secondary, backgroundColor: colors.rowTint, fontSize: 11, fontWeight: '700' },
  joinedStatus: { color: colors.primary, backgroundColor: colors.selected },
  pendingStatus: { backgroundColor: colors.warning },
  identity: { gap: 3 },
  name: { color: colors.foreground, fontSize: 16, lineHeight: 20, fontWeight: '800' },
  caption: { color: colors.secondary, fontSize: 11, lineHeight: 15 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    borderTopWidth: 1, borderTopColor: colors.softBorder, paddingTop: 8, marginTop: 'auto' },
  action: { flexShrink: 1, color: colors.primary, fontSize: 12, fontWeight: '700' },
  waiting: { color: colors.secondary },
});
