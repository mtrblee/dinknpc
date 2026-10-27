import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupsApi } from '../../services/groupsApi';
import type { SavedGroup } from '../../types/api';
import { GameHistory } from './GameHistory';
import { colors, styles } from './ui';
import { GroupAvatar } from './GroupAvatar';

export function GroupScreen({
  group, api, onUpdate, onOpenLeaderboard, onOpenGames, onOpenTournaments, onOpenSettings, onOpenOverview,
}: {
  group: SavedGroup; api: GroupsApi; onUpdate: (group: SavedGroup) => void;
  onOpenLeaderboard: () => void; onOpenGames: () => void;
  onOpenTournaments: (id: string | null) => void;
  onOpenSettings: () => void;
  onOpenOverview: () => void;
}) {
  const gameTypes = [
    { title: 'Create a single game', description: 'Casual doubles', onPress: onOpenGames },
    { title: 'Create a tournament', description: 'Fixed or rotating partners', onPress: () => onOpenTournaments(null) },
  ];

  return (
    <View style={styles.section}>
      <View style={overview.header}>
        <GroupAvatar avatar={group.avatar} size={44} />
        <Text accessibilityRole="header" style={[styles.heading, overview.name]}>{group.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Group settings"
            accessibilityHint={group.canManage ? 'Manage players, join requests, and group settings.' : 'View and add registered players.'}
            onPress={onOpenSettings}
            style={({ pressed }) => [overview.settings, pressed && styles.dimmed]}>
            <Text accessible={false} allowFontScaling={false} style={overview.gear}>{'\u2699\uFE0E'}</Text>
          </Pressable>
      </View>
      <View style={overview.shortcuts}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Overview of ${group.name}`}
          accessibilityHint="Opens group details and the current players."
          onPress={onOpenOverview} style={({ pressed }) => [overview.shortcut, pressed && styles.dimmed]}>
          <Text style={overview.shortcutTitle}>Overview</Text>
          <Text style={overview.shortcutDetail}>About &amp; players</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`View leaderboard for ${group.name}`}
          onPress={onOpenLeaderboard} style={({ pressed }) => [overview.shortcut, overview.leaderboard, pressed && styles.dimmed]}>
          <Text style={[overview.shortcutTitle, overview.lightTitle]}>Leaderboard</Text>
          <Text style={[overview.shortcutDetail, overview.lightDetail]}>Ranks &amp; results</Text>
        </Pressable>
      </View>
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.heading}>Game Types</Text>
        <View style={overview.gameGrid}>
          {gameTypes.map((type, index) => (
            <View key={type.title} style={overview.gameCell}>
              <Pressable accessibilityRole="button" accessibilityLabel={type.title}
                accessibilityHint={index === 0 ? 'Opens doubles game setup and in-progress games.'
                  : 'Opens tournaments. The owner and admins can create tournaments; members can view and score matches.'}
                onPress={type.onPress}
                style={({ pressed }) => [overview.gameButton, index % 2 === 1 && overview.tournamentButton, pressed && styles.dimmed]}>
                <Text accessible={false} style={overview.gameNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.stack}>
                  <Text style={overview.gameTitle}>{type.title}</Text>
                  <Text style={overview.gameDescription}>{type.description}</Text>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      </View>
      <GameHistory group={group} api={api} onUpdate={onUpdate} onOpenTournament={onOpenTournaments} />
    </View>
  );
}

const overview = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1 },
  settings: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.selected },
  gear: { fontSize: 24, color: colors.primary },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcut: { flex: 1, minWidth: 0, minHeight: 76, padding: 12, gap: 4, justifyContent: 'center',
    borderRadius: 16, backgroundColor: colors.selected },
  shortcutTitle: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  shortcutDetail: { color: colors.secondary, fontSize: 12 },
  leaderboard: { backgroundColor: colors.hero },
  lightTitle: { color: colors.surface },
  lightDetail: { color: colors.onHero },
  gameGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginVertical: -6 },
  gameCell: { width: '50%', padding: 6 },
  gameButton: { flex: 1, minHeight: 140, gap: 16, padding: 12, borderRadius: 20, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.selected, justifyContent: 'space-between' },
  tournamentButton: { backgroundColor: '#EDF1FA', borderColor: '#D5DEEE' },
  gameNumber: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  gameTitle: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  gameDescription: { color: colors.secondary, fontSize: 12 },
});
