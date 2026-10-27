import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tournamentPhase, tournamentPlayerIds } from '../../domain/tournaments';
import { formatActivityTimestamp } from '../../domain/timestamps';
import type { SavedGroup } from '../../types/api';
import type { Tournament } from '../../types/tournaments';
import { colors, styles } from './ui';

const phaseLabels = {
  pool: 'Pool games',
  ready: 'Ready for playoffs',
  playoffs: 'Playoffs',
  completed: 'Completed',
};

export function TournamentList({ group, tournaments, busy, stale, onCreate, onOpen }: {
  group: SavedGroup;
  tournaments: readonly Tournament[];
  busy: boolean;
  stale: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const entries = tournaments.map((tournament) => {
    const phase = tournamentPhase(group, tournament);
    const rotating = tournament.style === 'rotating-partner-round-robin';
    return { tournament, phase, phaseLabel: rotating && phase === 'pool' ? 'Round robin' : phaseLabels[phase],
      detail: rotating ? `${tournamentPlayerIds(tournament).length} players / rotating partners` : `${tournament.teams.length} fixed teams` };
  });
  const names = new Set<string>();
  const duplicateNames = new Set<string>();
  for (const tournament of tournaments) {
    const name = tournament.name.toLowerCase();
    if (names.has(name)) duplicateNames.add(name);
    names.add(name);
  }
  const sections = [
    { title: 'In progress', entries: entries.filter((entry) => entry.phase !== 'completed'), empty: 'No tournaments in progress.' },
    { title: 'Completed', entries: entries.filter((entry) => entry.phase === 'completed'), empty: 'No completed tournaments yet.' },
  ];
  const createDisabled = busy || stale || !group.canManage;

  return (
    <View style={tiles.screen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Create tournament"
        accessibilityHint={group.canManage ? 'Opens tournament setup.' : 'Only the owner or an admin can create a tournament.'}
        accessibilityState={{ disabled: createDisabled }} disabled={createDisabled} onPress={onCreate}
        style={({ pressed }) => [tiles.create, (pressed || createDisabled) && styles.dimmed]}>
        <View style={tiles.addIcon} accessible={false}>
          <Text allowFontScaling={false} style={tiles.plus}>+</Text>
        </View>
        <View style={tiles.createCopy}>
          <Text style={tiles.createTitle}>Create tournament</Text>
          <Text style={tiles.createCaption}>{group.canManage ? 'Fixed teams or rotating partners.' : 'Only the owner or an admin can create tournaments.'}</Text>
        </View>
      </Pressable>
      {sections.map((section) => (
        <View key={section.title} style={styles.stack}>
          <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
          {section.entries.length === 0 ? (
            <Text style={styles.secondary}>{section.empty}</Text>
          ) : (
            <View style={tiles.grid}>
              {section.entries.map(({ tournament, phase, phaseLabel, detail }) => (
                <View key={tournament.id} style={tiles.cell}>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={`Open tournament ${tournament.name}. ${phaseLabel}. ${detail}. ${formatActivityTimestamp(phase === 'completed', tournament)}.${duplicateNames.has(tournament.name.toLowerCase()) ? ` ID: ${tournament.id}.` : ''}`}
                    accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onOpen(tournament.id)}
                    style={({ pressed }) => [tiles.card, phase === 'completed' && tiles.completedCard, (pressed || busy) && styles.dimmed]}>
                    <View style={tiles.cardTop}>
                      <Text style={[tiles.phase, phase === 'completed' && tiles.completedPhase]}>{phaseLabel}</Text>
                      <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
                    </View>
                    <View style={styles.stack}>
                      <Text style={tiles.name}>{tournament.name}</Text>
                      <Text style={tiles.detail}>{detail}</Text>
                      <Text style={tiles.detail}>{formatActivityTimestamp(phase === 'completed', tournament)}</Text>
                      {duplicateNames.has(tournament.name.toLowerCase()) && <Text style={tiles.id}>ID: {tournament.id}</Text>}
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const tiles = StyleSheet.create({
  screen: { gap: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  create: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 20,
    backgroundColor: colors.hero, borderWidth: 1, borderColor: colors.primary },
  addIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.highlight,
    alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, color: colors.foreground },
  createCopy: { flex: 1, minWidth: 0, gap: 6 },
  createTitle: { fontSize: 20, fontWeight: '800', color: colors.surface },
  createCaption: { fontSize: 12, color: colors.onHero },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginVertical: -6 },
  cell: { width: '50%', padding: 6 },
  card: { flex: 1, minHeight: 148, padding: 12, gap: 20, borderRadius: 18, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.selected, justifyContent: 'space-between' },
  completedCard: { backgroundColor: colors.surface, borderColor: colors.softBorder, borderTopWidth: 3, borderTopColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  phase: { flex: 1, color: colors.primary, fontSize: 11, fontWeight: '700' },
  completedPhase: { color: colors.secondary },
  name: { fontSize: 16, fontWeight: '800', color: colors.foreground },
  detail: { fontSize: 12, color: colors.secondary },
  id: { fontSize: 11, color: colors.secondary },
});
