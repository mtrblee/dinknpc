import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { currencySymbol, formatUnits } from '../../domain/groups';
import { getIndividualStandings } from '../../domain/individualStats';
import type { SavedGroup } from '../../types/api';
import { colors, signedTone, styles } from './ui';
import { GroupAvatar } from './GroupAvatar';

export function IndividualStatsScreen({ groups, playerId, onOpen }: {
  groups: readonly SavedGroup[]; playerId: string; onOpen: (id: string) => void;
}) {
  const rows = useMemo(() => getIndividualStandings(groups, playerId), [groups, playerId]);
  return (
    <View style={tiles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Individual statistics</Text>
      <Text style={styles.secondary}>{groups.length} groups created or joined. Tap a tile to open its group.</Text>
      <Text style={tiles.caption}>Ranked by wins, then point differential. Ties share a rank.</Text>
      {rows.length === 0 && <Text style={styles.body}>Create or join a group to start your statistics.</Text>}
      <View style={tiles.grid}>
        {rows.map(({ groupId, groupName, standing }, index) => {
          const group = groups[index];
          const rank = !standing ? 'Not playing' : standing.rank === null ? 'Unranked' : `Rank #${standing.rank}`;
          const differential = standing ? `${standing.pointDifferential > 0 ? '+' : ''}${standing.pointDifferential}` : '';
          const net = standing && group.currency !== 'none'
            ? `${standing.netUnits > 0 ? '+' : ''}${formatUnits(standing.netUnits, group.currency)}` : null;
          const description = standing
            ? `${rank}. ${standing.wins} wins, ${standing.losses} losses. Point differential ${differential}.` +
              (net !== null ? ` Simulated net (${group.currency === 'money' ? 'Money' : 'Boba'}) ${net}.` : '')
            : 'You are not in the playing roster. Add your player ID in the group to participate.';
          return (
            <View key={groupId} style={tiles.cell}>
              <Pressable accessibilityRole="button"
                accessibilityLabel={`${groupName}. Created by ${group.ownerName}. ${description}`}
                accessibilityHint="Opens this group." onPress={() => onOpen(groupId)}
                style={({ pressed }) => [tiles.card, pressed && styles.dimmed]}>
                <View style={tiles.top}>
                  <View accessible={false} importantForAccessibility="no-hide-descendants">
                    <GroupAvatar avatar={group.avatar} size={30} />
                  </View>
                  <Text style={tiles.rank}>{rank}</Text>
                </View>
                <View style={tiles.identity}>
                  <Text style={tiles.name} numberOfLines={2}>{groupName}</Text>
                  <Text style={tiles.caption} numberOfLines={2}>Created by {group.ownerName}</Text>
                </View>
                {standing ? (
                  <View style={tiles.metrics}>
                    <View style={tiles.metricRow}>
                      <Text style={tiles.caption}>Wins / losses</Text>
                      <Text style={tiles.value}>{standing.wins} / {standing.losses}</Text>
                    </View>
                    <View style={tiles.metricRow}>
                      <Text style={tiles.caption}>Point diff.</Text>
                      <Text style={[tiles.value, signedTone(standing.pointDifferential)]}>{differential}</Text>
                    </View>
                    {group.currency !== 'none' && (
                      <View style={tiles.metricRow}>
                        <Text style={tiles.caption}>Simulated net ({currencySymbol(group.currency)})</Text>
                        <Text style={[tiles.value, signedTone(standing.netUnits)]}>{net}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={tiles.notPlaying}>Add your player ID in this group to join the roster.</Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const tiles = StyleSheet.create({
  screen: { gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginVertical: -5 },
  cell: { width: '50%', padding: 5 },
  card: { flex: 1, minWidth: 0, minHeight: 172, padding: 12, gap: 10, borderRadius: 18,
    borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.surface },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  rank: { flexShrink: 1, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8,
    backgroundColor: colors.selected, color: colors.primary, fontSize: 11, fontWeight: '700' },
  identity: { gap: 3 },
  name: { color: colors.foreground, fontSize: 16, lineHeight: 20, fontWeight: '800' },
  caption: { color: colors.secondary, fontSize: 11, lineHeight: 15, flexShrink: 1 },
  metrics: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.softBorder, marginTop: 'auto' },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  value: { color: colors.foreground, fontSize: 13, fontWeight: '700', maxWidth: '100%' },
  notPlaying: { color: colors.secondary, fontSize: 12, lineHeight: 17, marginTop: 'auto' },
});
