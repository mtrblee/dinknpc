import { StyleSheet, Text, View } from 'react-native';
import type { SavedGroup } from '../../types/api';
import { GroupAvatar } from './GroupAvatar';
import { GroupRoster } from './GroupRoster';
import { colors, styles } from './ui';

export function GroupOverviewScreen({ group }: { group: SavedGroup }) {
  const players = group.players.filter((player) => !player.isDeleted);
  const completed = group.games.filter((game) => game.status === 'completed').length;
  return (
    <View style={overview.screen}>
      <View style={overview.card}>
        <View style={styles.playerRow}>
          <GroupAvatar avatar={group.avatar} size={40} />
          <View style={overview.identity}>
            <Text style={overview.caption}>Overview</Text>
            <Text accessibilityRole="header" style={overview.title}>{group.name}</Text>
          </View>
        </View>
        <Text style={overview.body}>
          A {group.isPublic ? 'public' : 'private'} pickleball group managed by {group.ownerName} for casual doubles and tournaments.
        </Text>
        <Text style={overview.caption}>
          {group.currency === 'none' ? 'Scores and standings only. No simulated wagers.'
            : group.currency === 'money' ? 'Casual games can track simulated whole-dollar USD wagers.'
            : 'Casual games can track simulated whole-boba wagers.'}
          {' '}Tournaments are wager-free.
        </Text>
        <Text style={overview.activity}>
          {players.length} current {players.length === 1 ? 'player' : 'players'} / {completed} completed {completed === 1 ? 'game' : 'games'}
        </Text>
      </View>
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={overview.heading}>Current players ({players.length})</Text>
        {players.length ? <GroupRoster group={group} players={players} />
          : <Text style={overview.body}>No current players. Add players in Group settings &gt; View players.</Text>}
        <Text style={overview.caption}>Manage the roster in Group settings &gt; View players. Guests have (g) before their name.</Text>
        {players.length !== group.players.length && (
          <Text style={overview.caption}>Deleted player entries remain in shared history, not the current-player list.</Text>
        )}
      </View>
    </View>
  );
}

const overview = StyleSheet.create({
  screen: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 16 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder, borderRadius: 16, padding: 14, gap: 10 },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 22, fontWeight: '800', color: colors.foreground },
  heading: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  body: { fontSize: 14, lineHeight: 20, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.secondary },
  activity: { fontSize: 12, fontWeight: '700', color: colors.primary },
});
