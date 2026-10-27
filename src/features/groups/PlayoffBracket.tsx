import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { getPlayerLabel } from '../../domain/groups';
import { currentMatchGame, isCurrentPlayerMatch, matchGameWins, matchWinner, requireTeam, tournamentMatchStatus } from '../../domain/tournaments';
import { formatActivityTimestamp } from '../../domain/timestamps';
import type { SavedGroup } from '../../types/api';
import type { Tournament, TournamentAction, TournamentMatch } from '../../types/tournaments';
import { colors, PlayerAvatar, styles, teamNames, tournamentMatchStatusLabels } from './ui';
import { getPlayoffLayout, playoffPlaceholder } from './playoffBracketLayout';
import { ResetPlayoffsAction } from './TournamentMatchCard';

function BracketTeam({ group, tournament, match, side }: {
  group: SavedGroup; tournament: Tournament; match: TournamentMatch; side: 'A' | 'B';
}) {
  const id = side === 'A' ? match.teamA : match.teamB;
  const game = currentMatchGame(group, match);
  const wins = matchGameWins(group, match);
  const score = match.gameIds ? (side === 'A' ? wins.a : wins.b)
    : game?.status === 'completed' ? (side === 'A' ? game.scoreA : game.scoreB) : null;
  const won = !!game && matchWinner(group, match) === id;
  const players = id ? requireTeam(tournament, id).players.map((playerId) => {
    const player = group.players.find((entry) => entry.id === playerId);
    if (!player) throw new Error('Bracket references a missing player.');
    return player;
  }) : [];
  return (
    <View style={bracket.teamRow}>
      {id ? (
          <View style={[bracket.names, bracket.teamPlayers, won && bracket.winningTeam]}>
            <Text style={bracket.seed}>Seed {tournament.seeds.indexOf(id) + 1}</Text>
            {players.map((player) => (
              <View key={player.id} style={bracket.player}>
                <PlayerAvatar avatar={player.avatar} size={18} />
                <Text numberOfLines={1} style={bracket.playerName}>{getPlayerLabel(group, player)}</Text>
              </View>
            ))}
          </View>
      ) : <Text numberOfLines={3} style={[styles.secondary, bracket.names]}>{playoffPlaceholder(tournament, match, side)}</Text>}
      <Text numberOfLines={1} adjustsFontSizeToFit style={bracket.score}>{score ?? '\u2014'}</Text>
    </View>
  );
}

export function PlayoffBracket({ group, tournament, currentPlayerId, busy, onOpenMatch, onAction }: {
  group: SavedGroup; tournament: Tournament; currentPlayerId: string; busy: boolean; onOpenMatch: (id: string) => void;
  onAction: (action: TournamentAction) => Promise<string | null>;
}) {
  const { fontScale } = useWindowDimensions();
  const layout = getPlayoffLayout(tournament, fontScale);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Playoff bracket</Text>
      {layout.nodes.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Waiting for playoff seeds</Text>
          <Text style={styles.body}>Finish every pool game, then the owner or an admin confirms the seed order in the Pool tab.</Text>
        </View>
      ) : (
        <>
          <ScrollView horizontal contentContainerStyle={bracket.scroll}>
            <View style={{ width: layout.width, height: layout.height, direction: 'ltr' }}>
              {layout.rounds.map((round) => (
                <Text key={round.round} accessibilityRole="header" style={[styles.heading, bracket.roundTitle,
                  { left: round.left, width: layout.cardWidth, height: layout.headingHeight }]}>{round.title}</Text>
              ))}
              <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {layout.lines.map((line, index) => <View key={index} style={[bracket.connector, line]} />)}
              </View>
              {layout.nodes.map((node) => {
                const game = currentMatchGame(group, node.match);
                const wins = matchGameWins(group, node.match);
                const yourGame = isCurrentPlayerMatch(group, tournament, node.match, currentPlayerId);
                const status = tournamentMatchStatusLabels[tournamentMatchStatus(group, tournament, node.match)];
                const statusLabel = `${yourGame ? 'Your current game - ' : ''}${status}${node.match.gameIds ? ` / Games ${wins.a}-${wins.b}` : ''}`;
                const names = (['A', 'B'] as const).map((side) => {
                  const id = side === 'A' ? node.match.teamA : node.match.teamB;
                  return id ? teamNames(group, requireTeam(tournament, id).players) : playoffPlaceholder(tournament, node.match, side);
                });
                const winner = matchWinner(group, node.match);
                const result = game?.status === 'completed' && winner
                  ? ` ${node.match.gameIds ? `Series games won ${wins.a} to ${wins.b}` : `Final score ${game.scoreA} to ${game.scoreB}`}. Winner: ${teamNames(group, requireTeam(tournament, winner).players)}.` : '';
                return (
                  <Pressable key={node.match.id} accessibilityRole="button"
                    accessibilityLabel={`${node.title}. ${names.join(' versus ')}. ${statusLabel}.${result}${game ? ` ${formatActivityTimestamp(game.status === 'completed', game)}.` : ''}`}
                    accessibilityHint="Opens match details and score entry when ready."
                    accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onOpenMatch(node.match.id)}
                    style={({ pressed }) => [bracket.match, { left: node.left, top: node.top, width: layout.cardWidth, height: layout.cardHeight },
                      yourGame && styles.currentGameCard, (pressed || busy) && styles.dimmed]}>
                    <View style={[bracket.matchHeading, yourGame && bracket.currentGameHeading]}>
                      <Text style={bracket.matchTitle}>{node.title}</Text>
                      <Text style={bracket.status}>{statusLabel}</Text>
                    </View>
                    <BracketTeam group={group} tournament={tournament} match={node.match} side="A" />
                    <BracketTeam group={group} tournament={tournament} match={node.match} side="B" />
                    {game && <Text style={bracket.timestamp}>{formatActivityTimestamp(game.status === 'completed', game)}</Text>}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <ResetPlayoffsAction group={group} tournament={tournament} busy={busy} onAction={onAction} />
        </>
      )}
    </View>
  );
}

const bracket = StyleSheet.create({
  scroll: { paddingBottom: 16 },
  roundTitle: { position: 'absolute', top: 0, paddingHorizontal: 4, fontSize: 18, lineHeight: 22 },
  connector: { position: 'absolute', backgroundColor: colors.border },
  match: { position: 'absolute', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder,
    borderRadius: 10, overflow: 'hidden', padding: 8, gap: 3 },
  matchHeading: { gap: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, backgroundColor: colors.hero },
  currentGameHeading: { backgroundColor: colors.accent },
  matchTitle: { fontSize: 13, fontWeight: '700', color: colors.surface },
  status: { fontSize: 10, fontWeight: '500', color: colors.onHero },
  timestamp: { fontSize: 10, lineHeight: 14, color: colors.secondary },
  teamRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  teamPlayers: { paddingHorizontal: 4, paddingVertical: 2, gap: 1, borderRadius: 6,
    borderLeftWidth: 3, borderLeftColor: 'transparent' },
  winningTeam: { backgroundColor: colors.winnerSurface, borderLeftColor: colors.winner },
  player: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  names: { flex: 1, minWidth: 0 },
  seed: { fontSize: 9, lineHeight: 11, color: colors.secondary },
  playerName: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, color: colors.foreground },
  score: { width: 28, textAlign: 'center', color: colors.foreground, fontSize: 16, fontWeight: '400', fontVariant: ['tabular-nums'] },
});
