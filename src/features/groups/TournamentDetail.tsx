import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { comparePoolStandings, currentPoolRound, getRankedPoolStandings, getRotatingStandings, matchWinner, tournamentPhase, tournamentPlayerIds } from '../../domain/tournaments';
import { formatActivityTimestamp } from '../../domain/timestamps';
import { tournamentScoringLabel } from '../../domain/tournamentScoring';
import type { SavedGroup } from '../../types/api';
import type { Tournament, TournamentAction } from '../../types/tournaments';
import { Action, colors, styles, tournamentTeamLabel } from './ui';
import { TournamentStandingsTable } from './TournamentStandingsTable';
import { ResetPlayoffsAction, TournamentMatchCard } from './TournamentMatchCard';
import { PlayoffBracket } from './PlayoffBracket';
import { TournamentStatusBanner } from './TournamentStatusBanner';

export type TournamentPage = 'overview' | 'pool' | 'pool-games' | 'playoffs' | 'match';
const tabs = [
  { page: 'overview', label: 'Overview' },
  { page: 'pool', label: 'Pool' },
  { page: 'pool-games', label: 'Pool Games' },
  { page: 'playoffs', label: 'Playoff' },
] as const;
const rotatingTabs = [
  { page: 'overview', label: 'Overview' },
  { page: 'pool', label: 'Standings' },
  { page: 'pool-games', label: 'Schedule' },
] as const;

export function TournamentDetail({ group, tournament, currentPlayerId, busy, page, matchId, onAction, onNavigate }: {
  group: SavedGroup; tournament: Tournament; currentPlayerId: string; busy: boolean; onAction: (action: TournamentAction) => Promise<string | null>;
  page: TournamentPage; matchId: string | null;
  onNavigate: (page: TournamentPage, matchId?: string) => void;
}) {
  const rotating = tournament.style === 'rotating-partner-round-robin';
  const rows = useMemo(() => rotating ? [] : getRankedPoolStandings(group, tournament), [group, tournament, rotating]);
  const individuals = useMemo(() => rotating ? getRotatingStandings(group, tournament) : [], [group, tournament, rotating]);
  const signature = rows.map((row) => `${row.teamId}:${row.wins}:${row.headToHeadWins}:${row.pointDifferential}`).join('|');
  const [seeds, setSeeds] = useState<readonly string[]>(rows.map((row) => row.teamId));
  useEffect(() => { setSeeds(rows.map((row) => row.teamId)); }, [signature, tournament.id]);
  const phase = tournamentPhase(group, tournament);
  const activeRound = currentPoolRound(group, tournament);
  const poolRounds = [...new Set(tournament.pool.map((match) => match.round))].sort((a, b) => a - b);

  function canSwap(index: number, other: number): boolean {
    const left = rows.find((row) => row.teamId === seeds[index]);
    const right = rows.find((row) => row.teamId === seeds[other]);
    return !!left && !!right && comparePoolStandings(left, right) === 0;
  }
  function move(index: number, other: number) {
    if (!canSwap(index, other)) return;
    const next = [...seeds];
    [next[index], next[other]] = [next[other], next[index]];
    setSeeds(next);
  }
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>{tournament.name}</Text>
      <TournamentStatusBanner group={group} tournament={tournament} busy={busy}
        onConfirmSeeds={() => void onAction({ type: 'start-playoffs', id: tournament.id, seeds })} />
      <View accessibilityRole="tablist" style={tabStyles.bar}>
        {(rotating ? rotatingTabs : tabs).map((tab) => {
          const selected = tab.page === page || (tab.page === 'playoffs' && page === 'match');
          return (
            <Pressable key={tab.page} accessibilityRole="tab" accessibilityLabel={tab.label}
              accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => onNavigate(tab.page)}
              style={({ pressed }) => [tabStyles.tab, selected && tabStyles.active, (pressed || busy) && styles.dimmed]}>
              <Text style={[tabStyles.label, selected && tabStyles.activeLabel]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={page === 'overview' ? overview.card : { display: 'none' }}>
        <Text accessibilityRole="header" style={overview.title}>Tournament overview</Text>
        <Text style={overview.heading}>{rotating ? `Rotating partners / ${tournamentPlayerIds(tournament).length} players`
          : `Fixed round robin / ${tournament.teams.length} teams`}</Text>
        <Text style={overview.note}>{formatActivityTimestamp(phase === 'completed', tournament)}</Text>
        <Text style={overview.body}>Each played game counts toward individual standings, including every game in a championship series. No simulated wagers.{!rotating && ' Byes do not count as wins.'}</Text>
        <View style={overview.section}>
          <Text accessibilityRole="header" style={overview.heading}>{rotating ? 'Individual standings' : 'Pool standings'}</Text>
          <Text style={overview.body}>{rotating ? 'Rank players by wins, then point differential, using only this tournament. Exact ties share a competition rank (1, 1, 3). Unplayed players are unranked.'
            : 'Wins, then wins against teams tied on pool wins, then overall pool point differential. The tie-break sequence is not restarted.'}</Text>
          {!rotating && <Text style={overview.body}>Exact ties share a rank. Playoff seeds stay separate.</Text>}
          {phase === 'pool' && <Text style={overview.body}>Standings are provisional until every scheduled game is completed.</Text>}
          {!rotating && <Text style={overview.body}>All teams advance. After the pool, the owner or an admin confirms playoff seeds and orders any exact ties. Highest seeds receive byes when needed.</Text>}
        </View>
        <View style={overview.section}>
          <Text accessibilityRole="header" style={overview.heading}>{rotating ? 'Rotating schedule' : 'Pool schedule'}</Text>
          <Text style={overview.body}>{rotating
            ? `Each player partners with every other player exactly once and faces each as an opponent twice. Everyone plays once per round: ${tournamentPlayerIds(tournament).length - 1} rounds / ${tournament.pool.length} games. Players and the schedule stay fixed after creation.`
            : 'Every pairing is played once. With an odd number of teams, one team rests each round.'}</Text>
          <Text style={overview.body}>{tournamentScoringLabel('pool', tournament.scoring)}. Win by two, no cap. Scoring rules stay fixed after creation.</Text>
          <Text style={overview.body}>Complete every game in the current round before entering scores for a later round. Games within the current round can be scored in any order.</Text>
        </View>
        {rotating ? <View style={overview.section}>
          <Text accessibilityRole="header" style={overview.heading}>Final results</Text>
          <Text style={overview.body}>There are no playoffs. The tournament completes when every scheduled game is saved. All players sharing 1st or 2nd place appear in the completed banner.</Text>
          <Text style={overview.body}>The owner or an admin can clear any result to correct it. This reopens the tournament and recalculates both tournament and group standings.</Text>
        </View> : (
        <View style={overview.section}>
          <Text accessibilityRole="header" style={overview.heading}>Playoff bracket</Text>
          <Text style={overview.body}>Follow the bracket from left to right. Swipe horizontally to see later rounds. Tap a match to view full names and enter final scores in the team rows.</Text>
          <Text style={overview.body}>Playoffs: {tournamentScoringLabel('playoff', tournament.scoring)}. Championship: {tournamentScoringLabel('championship', tournament.scoring)}. Every game is win by two, with no cap. Saved match winners advance automatically.</Text>
          <Text style={overview.body}>Byes advance a team without a played game or standings win. Reset playoffs before correcting a pool or earlier playoff result.</Text>
          <Text style={overview.body}>The championship winner takes 1st place and the runner-up takes 2nd. Placements appear only after the final result is saved.</Text>
          {tournament.scoring?.championship === 'best-of-3-11' && <Text style={overview.body}>Enter one game at a time; the championship ends when a team wins two games. Each game's wins, losses, and points count separately toward group standings. Clearing a championship result resets the entire series.</Text>}
        </View>
        )}
      </View>
      <View style={page === 'pool' ? styles.section : { display: 'none' }}>
        <Text accessibilityRole="header" style={styles.heading}>{rotating ? 'Individual standings' : 'Pool standings'}</Text>
        <TournamentStandingsTable group={group} tournament={tournament} rows={rotating ? individuals : rows} />
        {!rotating && phase === 'ready' && (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>Playoff seeds</Text>
            <Text style={styles.body}>All teams advance. The owner or an admin can reorder exact ties below; only tied teams can be moved. Use the confirmation tile above to accept this order and start playoffs. Highest seeds receive byes when needed.</Text>
            {seeds.map((id, index) => (
              <View key={id} style={styles.stack}>
                <Text style={styles.label}>{index + 1}. {tournamentTeamLabel(group, tournament, id)}</Text>
                {group.canManage && (canSwap(index, index - 1) || canSwap(index, index + 1)) && (
                  <>
                    <Action title={`Move ${id.replace('team-', 'Team ')} up`} disabled={busy || !canSwap(index, index - 1)} onPress={() => move(index, index - 1)} />
                    <Action title={`Move ${id.replace('team-', 'Team ')} down`} disabled={busy || !canSwap(index, index + 1)} onPress={() => move(index, index + 1)} />
                  </>
                )}
              </View>
            ))}
          </View>
        )}
        {!rotating && phase === 'ready' && !group.canManage && <Text style={styles.body}>Waiting for the owner or an admin to confirm seeds and start playoffs.</Text>}
      </View>
      <View style={page === 'pool-games' ? styles.section : { display: 'none' }}>
        <Text accessibilityRole="header" style={styles.heading}>{rotating ? 'Round-robin schedule' : 'Pool schedule'}</Text>
        {!rotating && <ResetPlayoffsAction group={group} tournament={tournament} busy={busy} onAction={onAction} />}
        {poolRounds.map((round) => {
          const matches = tournament.pool.filter((match) => match.round === round);
          const completed = matches.filter((match) => matchWinner(group, match)).length;
          const status = completed === matches.length ? 'Completed' : round === activeRound ? 'Current round' : 'Locked';
          return (
            <View key={round} style={schedule.round}>
              <View style={schedule.header}>
                <Text accessibilityRole="header" style={schedule.title}>Round {round}</Text>
                <Text style={[schedule.status, round === activeRound && schedule.current]}>{status}</Text>
              </View>
              <Text style={styles.scoreNote}>{completed} of {matches.length} games completed</Text>
              {matches.map((match) => <TournamentMatchCard key={match.id} group={group} tournament={tournament} match={match}
                currentPlayerId={currentPlayerId} busy={busy} onAction={onAction} />)}
            </View>
          );
        })}
      </View>
      {!rotating && <View style={page === 'playoffs' ? styles.section : { display: 'none' }}>
        <PlayoffBracket group={group} tournament={tournament} currentPlayerId={currentPlayerId} busy={busy}
          onAction={onAction} onOpenMatch={(id) => onNavigate('match', id)} />
      </View>}
      {tournament.playoffs.map((match) => (
        <View key={match.id} style={page === 'match' && matchId === match.id ? styles.section : { display: 'none' }}>
          <TournamentMatchCard group={group} tournament={tournament} match={match} currentPlayerId={currentPlayerId} busy={busy} onAction={onAction} />
          <Text style={styles.secondary}>Saved results update the bracket. Choose Playoff to follow the advancing teams.</Text>
        </View>
      ))}
      {page === 'match' && !tournament.playoffs.some((match) => match.id === matchId) && (
        <Text style={styles.body}>This match is no longer in the bracket. The playoffs may have been reset. Choose Playoff to view the current schedule.</Text>
      )}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 14, borderWidth: 1,
    borderColor: colors.softBorder, backgroundColor: colors.rowTint },
  tab: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 6, paddingVertical: 10,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: colors.primary },
  label: { fontSize: 12, fontWeight: '700', textAlign: 'center', color: colors.secondary },
  activeLabel: { color: colors.surface },
});

const schedule = StyleSheet.create({
  round: { gap: 10, borderTopWidth: 1, borderTopColor: colors.softBorder, paddingTop: 12 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.foreground },
  status: { fontSize: 12, fontWeight: '600', color: colors.secondary, paddingHorizontal: 7, paddingVertical: 4,
    borderRadius: 6, backgroundColor: colors.rowTint },
  current: { color: colors.accent, backgroundColor: colors.accentSurface },
});

const overview = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1, borderColor: colors.softBorder, borderRadius: 16, backgroundColor: colors.surface },
  title: { fontSize: 18, fontWeight: '800', color: colors.foreground },
  heading: { fontSize: 14, fontWeight: '700', color: colors.foreground },
  body: { fontSize: 13, lineHeight: 19, color: colors.secondary },
  note: { fontSize: 12, lineHeight: 17, color: colors.secondary },
  section: { borderTopWidth: 1, borderTopColor: colors.softBorder, paddingTop: 10, gap: 6 },
});
