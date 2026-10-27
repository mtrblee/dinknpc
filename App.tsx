import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { AuthGate } from './src/features/auth/AuthGate';
import type { AccountControls } from './src/features/auth/AuthGate';
import { SettingsScreen } from './src/features/auth/SettingsScreen';
import { AccountDeletionStatusScreen } from './src/features/auth/AccountDeletionScreen';
import type { AuthService, AuthUser } from './src/services/auth';
import { GroupScreen } from './src/features/groups/GroupScreen';
import { GroupOverviewScreen } from './src/features/groups/GroupOverviewScreen';
import { HomeScreen } from './src/features/groups/HomeScreen';
import { GroupCreationGuide } from './src/features/groups/GroupCreationGuide';
import { GroupsListScreen } from './src/features/groups/GroupsListScreen';
import { GroupPlayersScreen } from './src/features/groups/GroupPlayersScreen';
import { GroupManagement, groupSettingsTitles } from './src/features/groups/GroupManagement';
import type { GroupSettingsPage } from './src/features/groups/GroupManagement';
import { GameSessionScreen } from './src/features/groups/GameSessionScreen';
import { TournamentsScreen } from './src/features/groups/TournamentsScreen';
import { LeaderboardScreen } from './src/features/groups/LeaderboardScreen';
import { GroupSearchScreen } from './src/features/groups/GroupSearchScreen';
import { IndividualStatsScreen } from './src/features/groups/IndividualStatsScreen';
import { getNativeGroupsApi } from './src/services/nativeGroupsApi';
import { DataError, dataErrorMessage } from './src/services/groupsApi';
import { GroupCache } from './src/services/groupCache';
import type { GroupsApi } from './src/services/groupsApi';
import { BackButton, colors, ErrorMessage, Field, styles } from './src/features/groups/ui';
import type { RefreshHandle } from './src/features/groups/ui';
import type { AccountDeletionStatus, GroupSummary, SavedGroup } from './src/types/api';
import type { AvatarId } from './src/domain/avatars';
import { savePlayerAvatar, savePlayerDisplayName } from './src/services/playerProfile';
import { CURRENCY_OPTIONS } from './src/domain/groups';
import type { GroupCurrency } from './src/types/groups';
import { DEFAULT_GROUP_AVATAR } from './src/domain/groupAvatars';
import type { GroupAvatarId } from './src/domain/groupAvatars';
import { GroupAvatar, GroupAvatarPicker } from './src/features/groups/GroupAvatar';
import { DeferredScreen } from './src/features/groups/DeferredScreen';

export default function App() {
  const [deletion, setDeletion] = useState<{ receipt: AccountDeletionStatus; api: GroupsApi; service: AuthService } | null>(null);
  if (deletion) return <AccountDeletionStatusScreen initial={deletion.receipt} api={deletion.api}
    service={deletion.service} onClose={() => setDeletion(null)} />;
  return <AuthGate>{(user, controls) => <GroupsApp user={user} controls={controls}
    onDeletionAccepted={(receipt, api) => setDeletion({ receipt, api, service: controls.service })} />}</AuthGate>;
}

type Tab = 'home' | 'stats' | 'groups' | 'search' | 'settings';
const tabs: readonly { id: Tab; title: string; icon: string }[] = [
  { id: 'home', title: 'Home', icon: '\u2302' },
  { id: 'stats', title: 'Stats', icon: '\u25A5' },
  { id: 'groups', title: 'Groups', icon: '\u2637' },
  { id: 'search', title: 'Search', icon: '\u2315' },
  { id: 'settings', title: 'Settings', icon: '\u2699\uFE0E' },
];

function GroupsApp({ user, controls, onDeletionAccepted }: {
  user: AuthUser; controls: AccountControls; onDeletionAccepted: (receipt: AccountDeletionStatus, api: GroupsApi) => void;
}) {
  const userId = user.id;
  const [tab, setTab] = useState<Tab>('home');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [connection] = useState<{ api: GroupsApi | null; error: string | null }>(() => {
    try { return { api: getNativeGroupsApi(userId), error: null }; }
    catch (caught) { return { api: null, error: dataErrorMessage(caught) }; }
  });
  const { api } = connection;
  const mountedAt = useRef(performance.now());
  const reportedInitialLoad = useRef(false);
  const cache = useRef(new GroupCache());
  const [summaries, setSummaries] = useState<readonly GroupSummary[]>([]);
  const [groups, setGroups] = useState<readonly SavedGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupListPage, setGroupListPage] = useState<'list' | 'create'>('list');
  const [groupPage, setGroupPage] = useState<'overview' | 'about' | 'players' | 'settings' | 'games' | 'tournaments'>('overview');
  const [groupSettingsPage, setGroupSettingsPage] = useState<GroupSettingsPage>('settings');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [leaderboardId, setLeaderboardId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<GroupCurrency>('none');
  const [groupAvatar, setGroupAvatar] = useState<GroupAvatarId>(DEFAULT_GROUP_AVATAR);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [refreshingPage, setRefreshingPage] = useState(false);
  const [creating, setCreating] = useState(false);
  const live = useRef(true);
  const loading = useRef(false);
  const submitting = useRef(false);
  const loadingStats = useRef(false);
  const refreshAfterDeparture = useRef(false);
  const opening = useRef(0);
  const groupScroll = useRef<ScrollViewInstance>(null);
  const managementRefresh = useRef<RefreshHandle>(null);
  const tournamentRefresh = useRef<RefreshHandle>(null);
  const searchRefresh = useRef<RefreshHandle>(null);
  const pulling = useRef(false);
  const navigation = useRef(0);
  const tabHistory = useRef<Tab[]>([]);
  const groupOrigin = useRef<Tab>('groups');
  const creationOrigin = useRef<Tab>('groups');
  const selected = groups.find((group) => group.id === selectedId);
  const leaderboardGroup = groups.find((group) => group.id === leaderboardId);

  const publishCache = useCallback(() => {
    setSummaries(cache.current.summaries);
    setGroups(cache.current.groups);
    setStatsLoaded(cache.current.statsReady);
    setSelectedId((current) => current && cache.current.groups.some((group) => group.id === current) ? current : null);
    setLeaderboardId((current) => current && cache.current.groups.some((group) => group.id === current) ? current : null);
  }, []);

  useEffect(() => { groupScroll.current?.scrollTo({ y: 0, animated: false }); }, [selectedId, groupPage, groupListPage, tournamentId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api || loading.current) return;
    loading.current = true;
    const started = cache.current.beginLoad();
    setRefreshing(true);
    setLoadError(null);
    try {
      const incoming = await api.summaries();
      if (!live.current) return;
      cache.current.applySummaries(incoming, started);
      publishCache();
      setLoaded(true);
    } catch (caught) {
      if (live.current) setLoadError(dataErrorMessage(caught));
    } finally {
      loading.current = false;
      if (live.current) setRefreshing(false);
      if (live.current && refreshAfterDeparture.current) {
        refreshAfterDeparture.current = false;
        void refresh();
      }
    }
  }, [api, publishCache]);

  const refreshStats = useCallback(async () => {
    if (!api || loadingStats.current) return;
    loadingStats.current = true;
    const started = cache.current.beginLoad();
    setStatsRefreshing(true);
    setStatsError(null);
    try {
      const incoming = await api.list();
      if (!live.current) return;
      cache.current.applyGroups(incoming, started);
      publishCache();
      setLoaded(true);
      if (!cache.current.statsReady) setStatsError('Groups changed while statistics were loading. Pull down to retry.');
    } catch (caught) {
      if (live.current) setStatsError(dataErrorMessage(caught));
    } finally {
      loadingStats.current = false;
      if (live.current) setStatsRefreshing(false);
    }
  }, [api, publishCache]);

  async function refreshGroup(id: string) {
    if (!api) return;
    const started = cache.current.beginLoad();
    try {
      const group = await api.get(id);
      if (!live.current) return;
      if (!cache.current.acceptGroup(group, started)) throw new DataError('This group changed while loading. Refresh and open it again.');
      publishCache();
    } catch (caught) {
      if (live.current && caught instanceof DataError && (caught.status === 403 || caught.status === 404)) {
        cache.current.remove(id);
        publishCache();
      }
      throw caught;
    }
  }

  async function pullToRefresh(operation: () => Promise<unknown>) {
    if (pulling.current) return;
    pulling.current = true;
    setRefreshingPage(true);
    try {
      await operation();
    } finally {
      pulling.current = false;
      if (live.current) setRefreshingPage(false);
    }
  }

  function refreshGroupPage() {
    return pullToRefresh(async () => {
      setOpenError(null);
      try {
        if (!selectedId) await refresh();
        else if (groupPage === 'tournaments' && tournamentRefresh.current) await tournamentRefresh.current.refresh();
        else {
          await refreshGroup(selectedId);
          if (groupPage === 'settings') await managementRefresh.current?.refresh();
        }
      } catch (caught) {
        if (live.current) setOpenError(dataErrorMessage(caught));
      }
    });
  }

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => { live.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (tab === 'stats') void refreshStats();
  }, [tab, refreshStats]);

  useEffect(() => {
    if (!loaded || reportedInitialLoad.current) return;
    reportedInitialLoad.current = true;
    if (__DEV__) console.info('[group-load]', JSON.stringify({
      operation: 'initial-group-commit', durationMs: Math.round(performance.now() - mountedAt.current),
      groupCount: summaries.length,
    }));
  }, [loaded, summaries.length]);

  function backTab() {
    Keyboard.dismiss();
    navigation.current += 1;
    setTab(tabHistory.current.pop() ?? 'home');
  }

  function back() {
    if (tab === 'settings') return false;
    if (leaderboardId) { navigation.current += 1; setLeaderboardId(null); return true; }
    if (tab === 'groups') {
      if (selectedId) {
        if (groupPage === 'tournaments') return false;
        Keyboard.dismiss();
        navigation.current += 1;
        if (groupPage === 'settings' && groupSettingsPage !== 'settings') {
          setGroupSettingsPage('settings');
          groupScroll.current?.scrollTo({ y: 0, animated: false });
        } else if (groupPage === 'players') {
          setGroupSettingsPage('settings');
          setGroupPage('settings');
        }
        else if (groupPage !== 'overview') setGroupPage('overview');
        else {
          setSelectedId(null);
          setTab(groupOrigin.current);
          groupOrigin.current = 'groups';
        }
        return true;
      }
      if (groupListPage === 'create') {
        Keyboard.dismiss();
        navigation.current += 1;
        setGroupListPage('list');
        setTab(creationOrigin.current);
        return true;
      }
    }
    if (tab === 'home') return false;
    backTab();
    return true;
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [tab, selectedId, groupPage, groupSettingsPage, groupListPage, leaderboardId]);

  function changeTab(next: Tab) {
    if (settingsBusy || controls.signingOut) return;
    Keyboard.dismiss();
    navigation.current += 1;
    if (next !== tab) tabHistory.current.push(tab);
    if (next === 'groups') {
      setSelectedId(null);
      setGroupListPage('list');
      setGroupPage('overview');
      setGroupSettingsPage('settings');
      setTournamentId(null);
      setLeaderboardId(null);
      setOpeningId(null);
      setOpenError(null);
      opening.current = navigation.current;
      groupScroll.current?.scrollTo({ y: 0, animated: false });
    }
    setTab(next);
    if (next === 'stats' && tab === 'stats') void refreshStats();
    else if (next !== 'settings' && next !== 'stats') void refresh();
  }

  async function openGroup(id: string, page: 'overview' | 'settings' = 'overview') {
    if (!api) return;
    const intent = ++navigation.current;
    opening.current = intent;
    setOpeningId(id);
    setOpenError(null);
    try {
      await refreshGroup(id);
      if (!live.current || navigation.current !== intent) return;
      selectGroup(id);
      setGroupPage(page);
    } finally {
      if (live.current && opening.current === intent) setOpeningId(null);
    }
  }

  function chooseGroup(id: string) {
    const pendingOpen = openGroup(id);
    const intent = navigation.current;
    void pendingOpen.catch((caught: unknown) => {
      if (live.current && navigation.current === intent) setOpenError(dataErrorMessage(caught));
    });
  }

  function selectGroup(id: string) {
    Keyboard.dismiss();
    navigation.current += 1;
    groupOrigin.current = tab;
    setSelectedId(id);
    setGroupListPage('list');
    setGroupPage('overview');
    setGroupSettingsPage('settings');
    setTab('groups');
  }
  function openGroupCreation() {
    if (!loaded || !api || submitting.current) return;
    Keyboard.dismiss();
    navigation.current += 1;
    creationOrigin.current = tab;
    setSelectedId(null);
    setGroupListPage('create');
    setTab('groups');
  }
  function openGroupPage(page: 'overview' | 'about' | 'games' | 'players' | 'settings') {
    Keyboard.dismiss();
    navigation.current += 1;
    setGroupPage(page);
    if (page === 'settings') {
      setGroupSettingsPage('settings');
      groupScroll.current?.scrollTo({ y: 0, animated: false });
    }
  }
  const openGroupSettingsPage = useCallback((page: GroupSettingsPage) => {
    Keyboard.dismiss();
    navigation.current += 1;
    setGroupSettingsPage(page);
    groupScroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  function selectTournament(id: string | null) {
    Keyboard.dismiss();
    navigation.current += 1;
    setTournamentId(id);
    groupScroll.current?.scrollTo({ y: 0, animated: false });
  }
  function openTournaments(id: string | null) {
    selectTournament(id);
    setGroupPage('tournaments');
  }
  function openLeaderboard(groupId: string) {
    Keyboard.dismiss();
    navigation.current += 1;
    setLeaderboardId(groupId);
  }

  async function submitGroup() {
    if (!api || submitting.current) return;
    submitting.current = true;
    setCreating(true);
    setError(null);
    const intent = navigation.current;
    try {
      const group = await api.create(name, currency, groupAvatar);
      if (!live.current) return;
      updateGroup(group);
      if (navigation.current === intent) {
        groupOrigin.current = creationOrigin.current;
        setSelectedId(group.id);
        setGroupListPage('list');
        setGroupPage('overview');
        setTab('groups');
      }
      setName('');
      setCurrency('none');
      setGroupAvatar(DEFAULT_GROUP_AVATAR);
      setError(null);
    } catch (caught) {
      if (live.current) setError(dataErrorMessage(caught));
    } finally {
      submitting.current = false;
      if (live.current) setCreating(false);
    }
  }

  function updateGroup(updated: SavedGroup, started?: number) {
    if (!live.current) return;
    if (started === undefined) cache.current.save(updated);
    else if (!cache.current.acceptGroup(updated, started)) {
      throw new DataError('This group changed while loading. Refresh and open it again.');
    }
    publishCache();
  }

  function exitGroup(id: string) {
    if (!live.current) return;
    cache.current.remove(id);
    publishCache();
    if (loading.current) refreshAfterDeparture.current = true;
    else void refresh();
  }

  async function saveAvatar(avatar: AvatarId) {
    const player = await savePlayerAvatar(controls.service, api, userId, avatar);
    if (!live.current) return;
    cache.current.updatePlayerProfile(player);
    publishCache();
  }

  async function saveDisplayName(name: string) {
    const player = await savePlayerDisplayName(controls.service, api, userId, name);
    if (!live.current) return;
    cache.current.updatePlayerProfile(player);
    publishCache();
  }

  return (
    <SafeAreaView style={layout.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' && tab !== 'settings' ? 'padding' : undefined} style={layout.page}>
      {tab !== 'home' && tab !== 'settings' && !(tab === 'groups' && selected && groupPage === 'tournaments') && (
        <View style={[layout.toolbar, tab === 'groups' && selected && groupPage === 'settings' && layout.settingsToolbar]}>
          <BackButton onPress={back} />
          {tab === 'groups' && selected && groupPage === 'settings' &&
            <Text accessibilityRole="header" style={layout.settingsTitle}>{groupSettingsTitles[groupSettingsPage]}</Text>}
        </View>
      )}
      {tab !== 'settings' && (connection.error || loadError || openError || controls.error || openingId || (!loaded && refreshing)) && (
        <View style={layout.feedback}>
          <ErrorMessage message={connection.error ?? loadError ?? controls.error} />
          <ErrorMessage message={openError} />
          {loadError && api && <Text style={styles.secondary}>Pull down to retry loading.</Text>}
          {!loaded && refreshing && <ActivityIndicator accessibilityLabel="Loading saved groups" color={colors.primary} />}
          {openingId && <ActivityIndicator accessibilityLabel="Opening group" color={colors.primary} />}
        </View>
      )}
      <ScrollView style={tab === 'home' ? layout.page : layout.hidden} contentContainerStyle={layout.content} alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={loaded && refreshing} onRefresh={() => void refresh()} enabled={!creating}
          tintColor={colors.primary} accessibilityLabel="Refresh saved groups" />}>
        <DeferredScreen active={tab === 'home'}>
        <HomeScreen groups={summaries} loaded={loaded} canCreate={loaded && !!api && !creating} canSearch={!!api}
          onCreate={openGroupCreation} onOpenGroup={chooseGroup}
          onOpenGroups={() => changeTab('groups')}
          onOpenStats={() => changeTab('stats')} onSearch={() => changeTab('search')} />
        </DeferredScreen>
      </ScrollView>
      <ScrollView style={tab === 'stats' ? layout.page : layout.hidden} contentContainerStyle={layout.content} alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={statsRefreshing} onRefresh={() => void refreshStats()} enabled={!creating}
          tintColor={colors.primary} accessibilityLabel="Refresh saved groups" />}>
        <DeferredScreen active={tab === 'stats'}>
          <ErrorMessage message={statsError} />
          {!statsLoaded && !statsError && <Text style={styles.secondary}>Loading your group statistics...</Text>}
          {statsError && <Text style={styles.secondary}>Pull down to retry loading statistics.</Text>}
          {statsLoaded && <IndividualStatsScreen groups={groups} playerId={userId} onOpen={chooseGroup} />}
        </DeferredScreen>
      </ScrollView>
      <ScrollView
        ref={groupScroll}
        style={tab === 'groups' ? layout.page : layout.hidden}
        contentContainerStyle={[layout.content, selected && groupPage === 'settings' && layout.settingsContent]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshingPage || (loaded && refreshing)} onRefresh={() => void refreshGroupPage()} enabled={!creating}
          tintColor={colors.primary} accessibilityLabel="Refresh saved groups" />}
      >
        <View style={selected || groupListPage !== 'list' ? layout.hidden : styles.section}>
          <DeferredScreen active={tab === 'groups' && !selected && groupListPage === 'list'}>
            <GroupsListScreen groups={summaries} loaded={loaded} canCreate={loaded && !!api && !creating}
              onOpen={chooseGroup} onCreate={openGroupCreation} />
          </DeferredScreen>
        </View>
        <View style={!selected && groupListPage === 'create' ? styles.section : layout.hidden}>
          <DeferredScreen active={tab === 'groups' && !selected && groupListPage === 'create'}>
            <View style={creation.screen}>
              <GroupCreationGuide />
              <View style={creation.card}>
                <View style={creation.hero}>
                  <View accessible={false} importantForAccessibility="no-hide-descendants">
                    <GroupAvatar avatar={groupAvatar} size={48} />
                  </View>
                  <View style={creation.heroCopy}>
                    <Text style={creation.eyebrow}>YOUR PICKLEBALL CREW</Text>
                    <Text accessibilityRole="header" style={creation.title}>Create a group</Text>
                    <Text style={creation.intro}>Make it yours. Add players after saving.</Text>
                  </View>
                </View>
                <View style={creation.form}>
                  <Field label="New group name" value={name} onChangeText={setName} autoCapitalize="words"
                    placeholder="e.g. Weekend Picklers" editable={!creating} />
                  <View style={creation.section}>
                    <GroupAvatarPicker value={groupAvatar} onChange={setGroupAvatar} disabled={creating} />
                  </View>
                  <View style={creation.section}>
                    <Text style={styles.label}>Currency type</Text>
                    <View style={creation.options}>
                      {CURRENCY_OPTIONS.map((option) => (
                        <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label}
                          accessibilityState={{ checked: currency === option.id, disabled: creating }} disabled={creating}
                          onPress={() => setCurrency(option.id)}
                          style={({ pressed }) => [creation.option, currency === option.id && creation.selectedOption,
                            (pressed || creating) && styles.dimmed]}>
                          <Text style={creation.optionLabel}>{option.label}</Text>
                          <Text style={creation.optionDetail}>
                            {option.id === 'none' ? 'Scores only' : option.id === 'money' ? 'Whole USD' : 'Whole bobas'}
                          </Text>
                          <View accessible={false} style={[creation.radio, currency === option.id && creation.selectedRadio]}>
                            {currency === option.id && <View style={creation.radioDot} />}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                    <View style={creation.note}>
                      <Text style={creation.caption}>
                        {currency === 'none' ? 'Scores and standings only. No simulated wagers.'
                          : currency === 'money' ? 'Simulated whole USD dollars for casual games. Minimum bet: $1. Blank or 0 means no wager.'
                          : 'Simulated whole bobas for casual games. An empty amount means 0.'}
                        {' '}Currency is fixed after creation. Tournaments never use wagers.
                      </Text>
                    </View>
                  </View>
                  <View style={creation.privacy}>
                    <Text style={creation.privacyTitle}>PRIVATE BY DEFAULT</Text>
                    <Text style={creation.caption}>You can make your group public later in Group settings.</Text>
                  </View>
                  <ErrorMessage message={error} />
                  <Pressable accessibilityRole="button" accessibilityLabel={creating ? 'Saving group...' : 'Create group'}
                    accessibilityState={{ disabled: !api || creating || refreshing, busy: creating }}
                    disabled={!api || creating || refreshing} onPress={() => void submitGroup()}
                    style={({ pressed }) => [creation.submit, (pressed || !api || creating || refreshing) && styles.dimmed]}>
                    {creating && <ActivityIndicator color={colors.surface} size="small" />}
                    <Text style={creation.submitLabel}>{creating ? 'Saving group...' : 'Create group'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DeferredScreen>
        </View>
        {selected && api && (
          <View key={selected.id} style={styles.section}>
            <View style={groupPage === 'overview' ? styles.section : layout.hidden}>
              <DeferredScreen active={tab === 'groups' && groupPage === 'overview'}>
              <GroupScreen
                group={selected}
                api={api}
                onUpdate={updateGroup}
                onOpenLeaderboard={() => openLeaderboard(selected.id)}
                onOpenGames={() => openGroupPage('games')}
                onOpenTournaments={openTournaments}
                onOpenOverview={() => openGroupPage('about')}
                onOpenSettings={() => openGroupPage('settings')}
              />
              </DeferredScreen>
            </View>
            <View style={groupPage === 'about' ? styles.section : layout.hidden}>
              <DeferredScreen active={tab === 'groups' && groupPage === 'about'}>
                <GroupOverviewScreen group={selected} />
              </DeferredScreen>
            </View>
            <View style={groupPage === 'players' ? styles.section : layout.hidden}>
              <DeferredScreen active={tab === 'groups' && groupPage === 'players'}>
                <GroupPlayersScreen group={selected} api={api} onUpdate={updateGroup} />
              </DeferredScreen>
            </View>
            {groupPage === 'settings' && (
              <GroupManagement group={selected} currentPlayerId={userId} api={api} onUpdate={updateGroup} onExit={exitGroup}
                onOpenPlayers={() => openGroupPage('players')} page={groupSettingsPage}
                onOpenPage={openGroupSettingsPage} refreshRef={managementRefresh} />
            )}
            <View style={groupPage === 'games' ? styles.section : layout.hidden}>
              <DeferredScreen active={tab === 'groups' && groupPage === 'games'}>
                <GameSessionScreen group={selected} api={api} onUpdate={updateGroup} />
              </DeferredScreen>
            </View>
            <View style={groupPage === 'tournaments' ? styles.section : layout.hidden}>
              <DeferredScreen active={tab === 'groups' && groupPage === 'tournaments'}>
              <TournamentsScreen group={selected} currentPlayerId={userId} api={api} active={tab === 'groups' && groupPage === 'tournaments'}
                selectedId={tournamentId} onSelect={selectTournament} onBack={() => openGroupPage('overview')} onUpdate={updateGroup}
                onLoadStart={() => cache.current.beginLoad()}
                refreshRef={tournamentRefresh}
                onScrollToTop={() => groupScroll.current?.scrollTo({ y: 0, animated: false })} />
              </DeferredScreen>
            </View>
          </View>
        )}
      </ScrollView>
      <ScrollView style={tab === 'search' ? layout.page : layout.hidden} contentContainerStyle={layout.content} keyboardShouldPersistTaps="handled"
        alwaysBounceVertical refreshControl={<RefreshControl refreshing={refreshingPage}
          onRefresh={() => void pullToRefresh(async () => { await searchRefresh.current?.refresh(); })}
          tintColor={colors.primary} accessibilityLabel="Refresh public group search" />}>
        <DeferredScreen active={tab === 'search'}>
          {api && <GroupSearchScreen api={api} active={tab === 'search'} onOpen={openGroup} refreshRef={searchRefresh} />}
        </DeferredScreen>
      </ScrollView>
      {tab === 'settings' && (
        <SettingsScreen user={user} service={controls.service} onClose={backTab}
          onSignOut={controls.onSignOut} signingOut={controls.signingOut} externalError={controls.error}
          onBusyChange={setSettingsBusy} onSaveAvatar={saveAvatar} onSaveDisplayName={saveDisplayName} api={api}
          onManageGroup={(id) => openGroup(id, 'settings')}
          onDeletionAccepted={(receipt) => {
            if (!live.current) return;
            if (!api) throw new DataError('The deletion receipt cannot be displayed without the data service.');
            onDeletionAccepted(receipt, api);
          }} />
      )}
      <View style={layout.tabBar} accessibilityRole="tablist">
        {tabs.map((item) => (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.title}
            accessibilityState={{ selected: tab === item.id, disabled: settingsBusy || controls.signingOut }}
            disabled={settingsBusy || controls.signingOut}
            onPress={() => changeTab(item.id)}
            style={({ pressed }) => [layout.tab, tab === item.id && layout.activeTab, pressed && styles.dimmed]}>
            <Text style={layout.tabIcon} accessible={false}>{item.icon}</Text>
            <Text style={layout.tabLabel}>{item.title}</Text>
          </Pressable>
        ))}
      </View>
      </KeyboardAvoidingView>
      {leaderboardGroup && (
        <LeaderboardScreen group={leaderboardGroup} onClose={() => setLeaderboardId(null)}
          onRefresh={() => pullToRefresh(async () => {
            setOpenError(null);
            try { await refreshGroup(leaderboardGroup.id); }
            catch (caught) { if (live.current) setOpenError(dataErrorMessage(caught)); }
          })} refreshing={refreshingPage} refreshError={openError} />
      )}
    </SafeAreaView>
  );
}

const creation = StyleSheet.create({
  screen: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 18 },
  card: { borderRadius: 22, borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.surface, overflow: 'hidden' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, backgroundColor: colors.hero },
  heroCopy: { flex: 1, minWidth: 0, gap: 5 },
  eyebrow: { color: colors.highlight, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: colors.surface, fontSize: 23, fontWeight: '800' },
  intro: { color: colors.onHero, fontSize: 12, lineHeight: 17 },
  form: { padding: 16, gap: 18 },
  section: { paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.softBorder, gap: 10 },
  options: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, minWidth: 0, minHeight: 82, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 5, gap: 5, borderRadius: 14, borderWidth: 2,
    borderColor: colors.softBorder, backgroundColor: colors.surface },
  selectedOption: { borderColor: colors.primary, backgroundColor: colors.selected },
  optionLabel: { color: colors.foreground, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  optionDetail: { color: colors.secondary, fontSize: 10, textAlign: 'center' },
  radio: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  selectedRadio: { borderColor: colors.primary },
  radioDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  note: { padding: 10, borderRadius: 12, backgroundColor: colors.rowTint },
  caption: { color: colors.secondary, fontSize: 12, lineHeight: 17 },
  privacy: { gap: 5 },
  privacyTitle: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  submit: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14,
    backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  submitLabel: { color: colors.surface, fontSize: 16, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
});

const layout = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  page: { flex: 1 },
  hidden: { display: 'none' },
  toolbar: { paddingHorizontal: 20, paddingTop: 4 },
  settingsToolbar: { paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10,
    width: '100%', maxWidth: 640, alignSelf: 'center' },
  settingsTitle: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.foreground },
  settingsContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 12 },
  feedback: { paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, padding: 6, gap: 2, backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 12, gap: 3 },
  activeTab: { backgroundColor: colors.selected },
  tabIcon: { fontSize: 23, color: colors.primary },
  tabLabel: { fontSize: 12, fontWeight: '600', color: colors.foreground, textAlign: 'center' },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 20,
  },
});
