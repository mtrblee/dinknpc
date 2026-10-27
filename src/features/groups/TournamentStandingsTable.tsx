import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { requireTeam } from '../../domain/tournaments';
import { getPlayerLabel } from '../../domain/groups';
import type { Group, Standing } from '../../types/groups';
import type { RankedPoolStanding, Tournament } from '../../types/tournaments';
import { colors, signedTone, teamPlayerLabels } from './ui';

export function TournamentStandingsTable({ group, tournament, rows }: {
  group: Group; tournament: Tournament; rows: readonly (RankedPoolStanding | Standing)[];
}) {
  const rotating = tournament.style === 'rotating-partner-round-robin';
  const scale = Math.max(1, useWindowDimensions().fontScale);
  const rankWidth = { width: 26 * scale };
  const nameWidth = { minWidth: 116 * scale };
  const numberWidth = { width: 26 * scale };
  const differenceWidth = { width: 48 * scale };
  return (
    <View style={table.section}>
      <ScrollView horizontal contentContainerStyle={table.scroll}>
        <View style={[table.frame, { minWidth: 300 * scale }]}>
          <View style={[table.row, table.header]}>
            <Text accessibilityLabel={rotating ? 'Individual rank' : 'Pool rank'} style={[table.heading, table.rank, rankWidth]}>{' '}</Text>
            <Text accessibilityLabel={rotating ? 'Player display names' : 'Team display names'} style={[table.heading, table.team, nameWidth]}>name</Text>
            <Text accessibilityLabel="Wins" style={[table.heading, table.number, numberWidth]}>w</Text>
            <Text accessibilityLabel="Losses" style={[table.heading, table.number, numberWidth]}>l</Text>
            <Text accessibilityLabel="Point differential" style={[table.heading, table.differential, differenceWidth]}>+/-</Text>
          </View>
          {rows.map((row, index) => {
            const names = 'player' in row ? [getPlayerLabel(group, row.player)] : teamPlayerLabels(group, requireTeam(tournament, row.teamId).players);
            const id = 'player' in row ? row.player.id : row.teamId;
            const difference = `${row.pointDifferential > 0 ? '+' : ''}${row.pointDifferential}`;
            return (
              <View key={id} accessible
                accessibilityLabel={`${row.rank === null ? 'Unranked' : `${rotating ? 'Individual' : 'Pool'} rank ${row.rank}`}. ${names.join(' and ')}. ${row.wins} wins, ${row.losses} losses. Point differential ${difference}.`}
                style={[table.row, table.divider, index % 2 === 1 && table.stripe, row.rank === 1 && table.leader]}>
                <Text style={[table.value, table.rank, rankWidth, table.rankText]}>{row.rank ?? '-'}</Text>
                <View style={[table.team, nameWidth]}>
                  {names.map((name, playerIndex) => <Text key={playerIndex} style={[table.value, table.teamName]}>{name}</Text>)}
                </View>
                <Text style={[table.value, table.number, numberWidth, table.positive]}>{row.wins}</Text>
                <Text style={[table.value, table.number, numberWidth]}>{row.losses}</Text>
                <Text style={[table.value, table.differential, differenceWidth,
                  signedTone(row.pointDifferential)]}>{difference}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const table = StyleSheet.create({
  section: { gap: 6 },
  scroll: { flexGrow: 1 },
  frame: { minWidth: 300, flex: 1, borderWidth: 1, borderColor: colors.softBorder, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6 },
  header: { backgroundColor: colors.hero, paddingVertical: 6 },
  divider: { borderTopWidth: 1, borderTopColor: colors.softBorder },
  heading: { fontSize: 12, fontWeight: '700', color: colors.surface, paddingHorizontal: 4 },
  value: { fontSize: 13, lineHeight: 18, color: colors.secondary, paddingHorizontal: 4 },
  rank: { width: 26, textAlign: 'center' },
  team: { flex: 1, minWidth: 116 },
  teamName: { color: colors.foreground, fontWeight: '600' },
  number: { width: 26, textAlign: 'center', fontVariant: ['tabular-nums'] },
  differential: { width: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  rankText: { fontWeight: '800', color: colors.primary },
  leader: { backgroundColor: colors.positiveSurface },
  stripe: { backgroundColor: colors.rowTint },
  positive: { color: colors.primary, fontWeight: '700' },
});
