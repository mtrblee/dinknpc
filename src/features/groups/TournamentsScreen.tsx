import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Text, View } from 'react-native';
import { dataErrorMessage } from '../../services/groupsApi';
import type { GroupsApi } from '../../services/groupsApi';
import type { SavedGroup } from '../../types/api';
import type { TournamentAction, TournamentCollection } from '../../types/tournaments';
import { TournamentDetail } from './TournamentDetail';
import type { TournamentPage } from './TournamentDetail';
import { TournamentSetup } from './TournamentSetup';
import { TournamentList } from './TournamentList';
import { BackButton, colors, ErrorMessage, styles } from './ui';
import type { RefreshHandle } from './ui';

export function TournamentsScreen({ group, currentPlayerId, api, active, selectedId, onSelect, onBack, onUpdate, onLoadStart, onScrollToTop, refreshRef }: {
  group: SavedGroup; currentPlayerId: string; api: GroupsApi; active: boolean; selectedId: string | null;
  onSelect: (id: string | null) => void; onBack: () => void; onUpdate: (group: SavedGroup, started?: number) => void;
  onLoadStart: () => number;
  onScrollToTop: () => void;
  refreshRef: Ref<RefreshHandle>;
}) {
  const [data, setData] = useState<TournamentCollection | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<{ tournamentId: string | null; page: TournamentPage; matchId: string | null }>({
    tournamentId: selectedId, page: 'overview', matchId: null,
  });
  const live = useRef(true);
  const pending = useRef(false);
  const attempted = useRef<string | null>(null);
  const currentGroup = useRef(group);
  currentGroup.current = group;
  const selected = data?.tournaments.find((entry) => entry.id === selectedId);
  const stale = !!data && group.revision > data.group.revision;
  const displayGroup = data && group.revision === data.group.revision ? group : data?.group;
  const page = route.tournamentId === selectedId ? route.page : 'overview';
  const matchId = route.tournamentId === selectedId ? route.matchId : null;

  useEffect(() => {
    setRoute({ tournamentId: selectedId, page: 'overview', matchId: null });
  }, [selectedId]);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    attempted.current = currentGroup.current.revision;
    setBusy(true);
    setError(null);
    const started = onLoadStart();
    try {
      const result = await api.tournaments(group.id);
      if (!live.current) return;
      setData(result);
      onUpdate(result.group, started);
    } catch (caught) {
      if (live.current) setError(`${dataErrorMessage(caught)} Pull down to retry.`);
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }, [api, group.id, onUpdate, onLoadStart]);
  useImperativeHandle(refreshRef, () => ({ refresh }), [refresh]);

  useEffect(() => {
    if (active && !pending.current && (!data || stale) && attempted.current !== group.revision) void refresh();
  }, [active, busy, data, stale, group.revision, refresh]);

  function navigate(next: TournamentPage, id: string | null = null) {
    if (pending.current) return;
    Keyboard.dismiss();
    setRoute({ tournamentId: selectedId, page: next, matchId: id });
    onScrollToTop();
  }
  function back() {
    if (pending.current) return;
    if (selectedId && page === 'match') navigate('playoffs');
    else if (creating || selectedId) { setCreating(false); onSelect(null); }
    else onBack();
  }
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [active, creating, selectedId, page, onBack, onSelect, onScrollToTop]);

  async function run(action: TournamentAction): Promise<string | null> {
    if (pending.current || !data) return 'Wait for the current request to finish, then try again.';
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.changeTournament(data.group, action);
      onUpdate(result.group);
      if (!live.current) return null;
      setData({ group: result.group, tournaments: result.tournaments });
      attempted.current = result.group.revision;
      setNotice('Current tournament state and group standings loaded.');
      if (action.type === 'create') { setCreating(false); onSelect(result.selectedId); }
      return null;
    } catch (caught) {
      const message = dataErrorMessage(caught);
      if (live.current) setError(message);
      else console.warn('A tournament save failed after leaving its page. Refresh to check the saved state.');
      return message;
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <BackButton onPress={back} disabled={busy} />
      {busy && <ActivityIndicator accessibilityLabel="Updating tournaments" color={colors.primary} />}
      <ErrorMessage message={error} />
      {notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
      {stale && <Text style={styles.secondary}>The group changed. Pull down to refresh before saving another change.</Text>}
      {data && displayGroup && !selectedId && !creating && (
        <TournamentList group={displayGroup} tournaments={data.tournaments} busy={busy} stale={stale}
          onCreate={() => { setCreating(true); onSelect(null); setNotice(null); }}
          onOpen={(id) => { onSelect(id); setNotice(null); }} />
      )}
      {displayGroup?.canManage && (
        <View style={creating ? styles.section : { display: 'none' }}>
          <TournamentSetup group={displayGroup} busy={busy || stale}
            onCreate={run} />
        </View>
      )}
      {data && displayGroup && selected && !creating && (
        <TournamentDetail key={selected.id} group={displayGroup} tournament={selected} currentPlayerId={currentPlayerId} busy={busy || stale}
          page={page} matchId={matchId} onAction={run} onNavigate={navigate} />
      )}
      {data && selectedId && !selected && <Text style={styles.error}>This tournament is no longer available. Return to the list and refresh.</Text>}
    </View>
  );
}
