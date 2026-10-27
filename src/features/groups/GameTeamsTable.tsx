import { useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { currencySymbol, formatUnits, getPlayerLabel } from '../../domain/groups';
import { formatActivityTimestamp } from '../../domain/timestamps';
import type { Game, Group, PendingGame } from '../../types/groups';
import { Action, colors, PlayerAvatar, styles } from './ui';

type ScoreEditor = {
  scoreA: string; scoreB: string; onChangeA: (value: string) => void; onChangeB: (value: string) => void; busy: boolean; disabled: boolean;
};

export function GameTeamsTable({ group, game, editor, compact = false }: {
  group: Group; game: Game; editor?: ScoreEditor; compact?: boolean;
}) {
  const completed = game.status === 'completed';
  const compactResult = compact && completed;
  const scoreWidth = (compactResult ? 32 : 52) * Math.min(2, Math.max(1, useWindowDimensions().fontScale));
  const teams = [
    { label: 'Team A', ids: game.teamA, score: completed ? game.scoreA : null, won: completed && game.scoreA > game.scoreB,
      draft: editor?.scoreA, onChange: editor?.onChangeA },
    { label: 'Team B', ids: game.teamB, score: completed ? game.scoreB : null, won: completed && game.scoreB > game.scoreA,
      draft: editor?.scoreB, onChange: editor?.onChangeB },
  ];
  const stage = game.tournament?.stage;
  const matchType = stage
    ? `Tournament / ${stage === 'pool' ? 'Round robin' : stage === 'playoff' ? 'Playoff' : 'Championship'}${game.tournament?.gameNumber ? ` / Game ${game.tournament.gameNumber}` : ''}`
    : 'Casual game';

  return (
    <View style={table.section}>
      <View style={[table.badge, stage && table.tournamentBadge]}>
        <Text style={[table.badgeText, stage && table.tournamentBadgeText]}>{matchType}</Text>
      </View>
      <View style={table.frame}>
        {teams.map((team, index) => {
          const players = team.ids.map((id) => {
            const player = group.players.find((entry) => entry.id === id);
            if (!player) throw new Error(`Game references missing player ${id}.`);
            return player;
          });
          return (
            <View key={team.label} accessible={completed || !editor}
              accessibilityLabel={completed || !editor
                ? `${team.label}: ${players.map((player) => getPlayerLabel(group, player)).join(' and ')}. ${completed ? `Score ${team.score}. ${team.won ? 'Winner.' : 'Lost.'}` : 'Awaiting final score.'}`
                : undefined}
              style={[table.row, index > 0 && table.divider, compactResult && table.compactRow,
                team.won && !compactResult && table.winner]}>
              <View style={[table.team, compactResult && table.compactTeam, compactResult && team.won && table.compactWinner]}>
                <View style={table.caption}>
                  <Text style={table.teamLabel}>{team.label}</Text>
                  {team.won && <Text style={[table.winnerLabel, compactResult && table.compactWinnerLabel]}>WINNER</Text>}
                  {!completed && !editor && <Text style={table.pendingLabel}>Pending</Text>}
                </View>
                {players.map((player) => (
                  <View key={player.id} style={table.player}>
                    <PlayerAvatar avatar={player.avatar} size={22} />
                    <Text style={table.playerName}>{getPlayerLabel(group, player)}</Text>
                  </View>
                ))}
              </View>
              <View style={[table.scoreColumn, { width: scoreWidth }]}>
                {!completed && editor ? (
                  <TextInput accessibilityLabel={`${team.label} final score`}
                    accessibilityHint={`Final score for ${players.map((player) => getPlayerLabel(group, player)).join(' and ')}.`}
                    value={team.draft} onChangeText={team.onChange} editable={!editor.busy && !editor.disabled}
                    accessibilityState={{ disabled: editor.busy || editor.disabled }}
                    keyboardType="number-pad" placeholder={'\u2014'} placeholderTextColor={colors.secondary}
                    selectTextOnFocus style={table.scoreInput} />
                ) : <Text style={[table.score, team.won && !compactResult && table.winningScore,
                  compactResult && table.compactScore]}>{team.score ?? '\u2014'}</Text>}
              </View>
            </View>
          );
        })}
      </View>
      {group.currency !== 'none' && !game.tournament && (
        <Text style={styles.scoreNote}>Simulated wager: {formatUnits(game.wagerUnits, group.currency)} {group.currency === 'money' ? 'USD' : currencySymbol(group.currency)} / player</Text>
      )}
      <Text style={styles.scoreNote}>{formatActivityTimestamp(completed, game)}</Text>
    </View>
  );
}

export function GameScoreEntry({ group, game, busy, disabled = false, onSave }: {
  group: Group; game: PendingGame; busy: boolean; disabled?: boolean; onSave: (scoreA: string, scoreB: string) => void;
}) {
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  return (
    <View style={table.section}>
      <GameTeamsTable group={group} game={game}
        editor={{ scoreA, scoreB, onChangeA: setScoreA, onChangeB: setScoreB, busy, disabled }} />
      <Action title={busy ? 'Saving result...' : 'Save final result'} onPress={() => onSave(scoreA, scoreB)} disabled={busy || disabled} compact />
    </View>
  );
}

const table = StyleSheet.create({
  section: { gap: 6 },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: colors.accentSurface },
  badgeText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  tournamentBadge: { backgroundColor: colors.positiveSurface },
  tournamentBadgeText: { color: colors.primary },
  frame: { borderWidth: 1, borderColor: colors.softBorder, borderRadius: 9, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 7, paddingVertical: 6,
    minHeight: 44, borderLeftWidth: 3, borderLeftColor: 'transparent', backgroundColor: colors.rowTint },
  divider: { borderTopWidth: 1, borderTopColor: colors.softBorder },
  winner: { backgroundColor: colors.positiveSurface, borderLeftColor: colors.primary },
  compactRow: { paddingHorizontal: 0, paddingVertical: 0, borderLeftWidth: 0, backgroundColor: colors.surface },
  team: { flex: 1, gap: 2, minWidth: 0 },
  compactTeam: { paddingHorizontal: 6, paddingVertical: 5, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  compactWinner: { backgroundColor: colors.winnerSurface, borderLeftColor: colors.winner },
  caption: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  teamLabel: { fontSize: 10, fontWeight: '700', color: colors.secondary },
  player: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  playerName: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.foreground },
  scoreColumn: { width: 52, alignItems: 'center' },
  scoreInput: { width: '100%', minHeight: 44, padding: 4, borderWidth: 1, borderColor: colors.accent,
    borderRadius: 7, backgroundColor: colors.surface, color: colors.foreground, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  score: { width: '100%', paddingVertical: 3, paddingHorizontal: 4, borderRadius: 7, backgroundColor: colors.accentSurface,
    color: colors.accent, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'center' },
  winningScore: { backgroundColor: colors.primary, color: colors.surface },
  compactScore: { paddingHorizontal: 0, borderRadius: 0, backgroundColor: 'transparent',
    color: colors.foreground, fontSize: 16, fontWeight: '400' },
  pendingLabel: { color: colors.secondary, fontSize: 10 },
  winnerLabel: { color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  compactWinnerLabel: { color: colors.winner },
});
