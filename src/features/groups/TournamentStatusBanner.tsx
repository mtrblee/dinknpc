import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getRotatingStandings, getTournamentPlacements, tournamentPhase } from '../../domain/tournaments';
import { getPlayerLabel } from '../../domain/groups';
import type { SavedGroup } from '../../types/api';
import type { Tournament } from '../../types/tournaments';
import { colors, styles, tournamentTeamLabel } from './ui';

export function TournamentStatusBanner({ group, tournament, busy, onConfirmSeeds }: {
  group: SavedGroup; tournament: Tournament; busy: boolean; onConfirmSeeds: () => void;
}) {
  const rotating = tournament.style === 'rotating-partner-round-robin';
  const phase = tournamentPhase(group, tournament);
  if (phase === 'ready') {
    const disabled = busy || !group.canManage;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Confirm playoff seeds and start playoffs"
        accessibilityHint={group.canManage
          ? 'Review or adjust exact ties in the Pool tab first. Confirms the displayed seed order.'
          : 'Only the owner or an admin can confirm seeds and start playoffs.'}
        accessibilityState={{ disabled }} disabled={disabled}
        onPress={disabled ? undefined : onConfirmSeeds}
        style={({ pressed }) => [banner.progress, (pressed || busy) && styles.dimmed]}>
        <View style={banner.progressIcon} accessible={false}>
          <Text allowFontScaling={false} style={banner.playIcon}>{'\u25B6'}</Text>
        </View>
        <View style={banner.copy}>
          <Text style={banner.progressTitle}>Confirm playoff seeds</Text>
          <Text style={banner.progressDetail}>
            Go to the Pool tab to review the generated playoff seeds and adjust any exact ties if needed.
          </Text>
          <Text style={[banner.progressDetail, group.canManage && banner.confirmAction]}>
            {group.canManage
              ? 'Tap this tile to confirm the displayed seed order and start playoffs.'
              : 'Only the owner or an admin can confirm seeds and start playoffs.'}
          </Text>
        </View>
      </Pressable>
    );
  }
  if (phase !== 'completed') {
    return (
      <View style={banner.progress} accessibilityLiveRegion="polite">
        <View style={banner.progressIcon} accessible={false}>
          <Text allowFontScaling={false} style={banner.playIcon}>{'\u25B6'}</Text>
        </View>
        <View style={banner.copy}>
          <Text accessibilityRole="header" style={banner.progressTitle}>In progress</Text>
          <Text style={banner.progressDetail}>
            {phase === 'pool' ? rotating ? 'Rotating round robin' : 'Pool games' : 'Playoffs'}
          </Text>
        </View>
      </View>
    );
  }
  let places: { id: string; name: string; label: string; winner: boolean }[];
  if (rotating) {
    places = getRotatingStandings(group, tournament).filter((row) => row.rank === 1 || row.rank === 2).map((row) => ({
      id: row.player.id, name: getPlayerLabel(group, row.player), label: row.rank === 1 ? '1st place' : '2nd place', winner: row.rank === 1,
    }));
  } else {
    const placements = getTournamentPlacements(group, tournament);
    if (!placements) throw new Error('A completed tournament is missing its championship placements.');
    places = [
      { id: placements.first, name: tournamentTeamLabel(group, tournament, placements.first), label: '1st place', winner: true },
      { id: placements.second, name: tournamentTeamLabel(group, tournament, placements.second), label: '2nd place', winner: false },
    ];
  }
  return (
    <View style={banner.completed} accessibilityLiveRegion="polite">
      <View style={banner.header}>
        <Text accessible={false} allowFontScaling={false} style={banner.trophy}>{'\u{1F3C6}'}</Text>
        <View style={banner.copy}>
          <Text style={banner.eyebrow}>TOURNAMENT COMPLETE</Text>
          <Text accessibilityRole="header" style={banner.title}>Champions</Text>
        </View>
      </View>
      {rotating && <Text style={banner.placeLabel}>Individual results / tied places are shared</Text>}
      {places.map((place) => (
        <View key={place.id} style={[banner.place, place.winner ? banner.gold : banner.silver]}>
          <Text accessible={false} allowFontScaling={false} style={banner.medal}>{place.winner ? '\u{1F947}' : '\u{1F948}'}</Text>
          <View style={banner.copy}>
            <Text style={banner.placeLabel}>{place.label}</Text>
            <Text style={banner.team}>{place.name}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const banner = StyleSheet.create({
  copy: { flex: 1, minWidth: 0, gap: 3 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
    backgroundColor: colors.hero },
  progressIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.heroAccent,
    alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 18, color: colors.highlight },
  progressTitle: { fontSize: 20, fontWeight: '800', color: colors.surface },
  progressDetail: { fontSize: 12, color: colors.onHero },
  confirmAction: { color: colors.surface, fontWeight: '700', marginTop: 4 },
  completed: { padding: 14, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: '#DCC78A', backgroundColor: '#FFFAEA' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trophy: { fontSize: 30 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#6E5514' },
  title: { fontSize: 22, fontWeight: '800', color: colors.foreground },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10, borderWidth: 1 },
  gold: { backgroundColor: '#F8E8B5', borderColor: '#E4CF8C' },
  silver: { backgroundColor: '#F0F2F4', borderColor: '#D6DBE1' },
  medal: { fontSize: 24 },
  placeLabel: { fontSize: 11, fontWeight: '800', color: colors.secondary },
  team: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.foreground },
});
