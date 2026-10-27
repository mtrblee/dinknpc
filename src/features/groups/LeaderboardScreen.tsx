import {
  Modal, Platform, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { currencySymbol, formatUnits, getPlayerLabel, getStandings } from '../../domain/groups';
import type { Group, GroupCurrency, Standing } from '../../types/groups';
import { BackButton, colors, ErrorMessage, signedTone, styles } from './ui';
import { GroupAvatar } from './GroupAvatar';

function PlayerStanding({ row, label, currency }: { row: Standing; label: string; currency: GroupCurrency }) {
  const leading = row.rank === 1;
  const differential = `${row.pointDifferential > 0 ? '+' : ''}${row.pointDifferential}`;

  return (
    <View style={[board.playerCard, leading && board.leadingCard]}>
      <View style={board.playerHeading}>
        <View
          accessible
          accessibilityLabel={row.rank === null ? 'Unranked' : `Rank ${row.rank}`}
          style={[board.rankBadge, leading && board.leadingBadge]}
        >
          <Text style={board.rankNumber}>{row.rank ?? '-'}</Text>
        </View>
        <View style={board.playerIdentity}>
          <Text accessibilityRole="header" style={board.playerName}>{label}</Text>
          {row.rank === null && <Text style={board.note}>Unranked / no completed games</Text>}
        </View>
      </View>
      <View style={board.playerStats}>
        <View style={board.playerStat}>
          <Text style={board.statLabel}>Wins</Text>
          <Text style={board.statValue}>{row.wins}</Text>
        </View>
        <View style={board.playerStat}>
          <Text style={board.statLabel}>Losses</Text>
          <Text style={board.statValue}>{row.losses}</Text>
        </View>
        <View style={board.playerStat}>
          <Text style={board.statLabel}>Point diff.</Text>
          <Text accessibilityLabel={`Point differential: ${differential}`} style={[board.statValue, signedTone(row.pointDifferential)]}>
            {differential}
          </Text>
        </View>
      </View>
      {currency !== 'none' && (
        <View style={board.netRow}>
          <Text style={board.note}>Simulated net ({currencySymbol(currency)})</Text>
          <Text style={[board.netValue, signedTone(row.netUnits)]}>
            {row.netUnits > 0 ? '+' : ''}{formatUnits(row.netUnits, currency)}
          </Text>
        </View>
      )}
    </View>
  );
}

export function LeaderboardScreen({ group, onClose, onRefresh, refreshing, refreshError }: {
  group: Group; onClose: () => void; onRefresh: () => Promise<void>; refreshing: boolean; refreshError: string | null;
}) {
  const standings = getStandings(group);
  const leaders = standings.filter((row) => row.rank === 1);
  const completedCount = group.games.filter((game) => game.status === 'completed').length;

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={board.screen}>
        <View style={board.frame} accessibilityViewIsModal>
          <View style={board.toolbar}>
            <BackButton onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={board.content} alwaysBounceVertical
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()}
              tintColor={colors.primary} accessibilityLabel="Refresh leaderboard" />}>
            <View style={board.hero}>
              <View
                style={board.heroAccent}
                pointerEvents="none"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              />
              <Text style={board.eyebrow}>DINKNOW / SAVED STANDINGS</Text>
              <Text accessibilityRole="header" style={board.title}>Leaderboard</Text>
              <View style={styles.playerRow}>
                <GroupAvatar avatar={group.avatar} size={32} />
                <Text style={[board.groupName, { flex: 1 }]}>{group.name}</Text>
              </View>
              <View style={board.heroStats}>
                <View style={board.heroStat}>
                  <Text style={board.heroNumber}>{group.players.length}</Text>
                  <Text style={board.heroLabel}>Players</Text>
                </View>
                <View style={board.heroStat}>
                  <Text style={board.heroNumber}>{completedCount}</Text>
                  <Text style={board.heroLabel}>Completed games</Text>
                </View>
              </View>
            </View>
            <Text style={board.localNotice}>
              Pull down to load the latest results or retry a failed load.
            </Text>
            <ErrorMessage message={refreshError} />

            {leaders.length > 0 ? (
              <View style={board.spotlight}>
                <Text style={board.spotlightEyebrow}>THE TOP SPOT / RANK 1</Text>
                <Text accessibilityRole="header" style={board.spotlightTitle}>
                  {leaders.length === 1 ? 'Leading the court' : 'Sharing the lead'}
                </Text>
                <View style={board.leaderNames}>
                  {leaders.map((row) => (
                    <Text key={row.player.id} style={board.leaderName}>{getPlayerLabel(group, row.player)}</Text>
                  ))}
                </View>
                <Text style={board.note}>
                  {leaders.length === 1
                    ? 'Out in front on wins, then point differential.'
                    : 'Equal wins. Equal point differential. An equally earned spot.'}
                </Text>
              </View>
            ) : (
              <View style={board.spotlight}>
                <Text style={board.spotlightEyebrow}>A FRESH START</Text>
                <Text accessibilityRole="header" style={board.spotlightTitle}>
                  {standings.length === 0 ? 'Your court is waiting' : 'The first rank is up for grabs'}
                </Text>
                <Text style={board.note}>
                  {standings.length === 0
                    ? 'Add players to your group, then record a doubles game to bring this board to life.'
                    : 'Complete a doubles game to set the first rankings. Pending games do not count.'}
                </Text>
              </View>
            )}

            {standings.length > 0 && (
              <View style={board.standings}>
                <Text accessibilityRole="header" style={board.sectionTitle}>Player standings</Text>
                <Text style={board.note}>
                  Ranked by wins, then point differential. Exact ties share a rank.
                  {' '}Players without completed games are unranked.
                </Text>
                {standings.map((row) => (
                  <PlayerStanding key={row.player.id} row={row} label={getPlayerLabel(group, row.player)} currency={group.currency} />
                ))}
              </View>
            )}

            <View style={board.footer}>
              <Text style={board.footerTitle}>The score, not the stakes.</Text>
              <Text style={board.note}>
                Losses never break ranking ties.
                {group.currency !== 'none' && ' Simulated totals also never affect rank. They track game results only, not payments, balances, or amounts owed.'}
              </Text>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const board = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  frame: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  toolbar: { paddingHorizontal: 20, paddingVertical: 8 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 },
  hero: {
    backgroundColor: colors.hero,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    overflow: 'hidden',
  },
  heroAccent: {
    position: 'absolute',
    right: -65,
    top: -65,
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 32,
    borderColor: colors.heroAccent,
  },
  eyebrow: { color: colors.highlight, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  title: { color: colors.surface, fontSize: 26, fontWeight: '800' },
  groupName: { color: colors.highlight, fontSize: 16, fontWeight: '600' },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.heroBorder,
    marginTop: 2,
    paddingTop: 10,
  },
  heroStat: { flexGrow: 1, flexBasis: 100, gap: 2 },
  heroNumber: { color: colors.surface, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heroLabel: { color: colors.onHero, fontSize: 12 },
  localNotice: { color: colors.secondary, fontSize: 12, textAlign: 'center' },
  spotlight: {
    backgroundColor: '#FBF4DE',
    borderWidth: 1,
    borderColor: '#E4D7AD',
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  spotlightEyebrow: { color: '#6E5514', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  spotlightTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  leaderNames: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  leaderName: {
    color: colors.foreground,
    backgroundColor: '#F1E3B4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  standings: { gap: 8 },
  sectionTitle: { color: colors.foreground, fontSize: 18, fontWeight: '700' },
  note: { color: colors.secondary, fontSize: 12, lineHeight: 17 },
  playerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.softBorder,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  leadingCard: { borderColor: '#B99A45', borderTopWidth: 2 },
  playerHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rankBadge: {
    minWidth: 28,
    maxWidth: '40%',
    padding: 4,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.selected,
  },
  leadingBadge: { backgroundColor: '#F1D782' },
  rankNumber: { maxWidth: '100%', color: colors.foreground, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  playerIdentity: { flex: 1, minWidth: 0, gap: 2 },
  playerName: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  playerStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  playerStat: {
    flexBasis: 70,
    flexGrow: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 4,
  },
  statLabel: { color: colors.secondary, fontSize: 11 },
  statValue: { maxWidth: '100%', color: colors.foreground, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  netRow: {
    borderTopWidth: 1,
    borderTopColor: colors.softBorder,
    paddingTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  netValue: { maxWidth: '100%', color: colors.secondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footerTitle: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
  footer: { borderTopWidth: 1, borderTopColor: colors.softBorder, paddingTop: 12, gap: 6 },
});
