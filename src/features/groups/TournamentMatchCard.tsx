import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { currentMatchGame, currentPoolRound, isCurrentPlayerMatch, matchGames, matchGameWins, requireTeam, tournamentMatchStatus } from '../../domain/tournaments';
import { tournamentScoringLabel } from '../../domain/tournamentScoring';
import type { SavedGroup } from '../../types/api';
import type { Tournament, TournamentAction, TournamentMatch } from '../../types/tournaments';
import { Action, ErrorMessage, styles, teamPlayerLabels, tournamentMatchStatusLabels } from './ui';
import { GameScoreEntry, GameTeamsTable } from './GameTeamsTable';
import { playoffPlaceholder, tournamentMatchTitle } from './playoffBracketLayout';

export function ResetPlayoffsAction({ group, tournament, busy, onAction }: {
  group: SavedGroup; tournament: Tournament; busy: boolean;
  onAction: (action: TournamentAction) => Promise<string | null>;
}) {
  if (!group.canManage || tournament.playoffs.length === 0) return null;
  return <Action title="Reset all playoffs" destructive disabled={busy} onPress={() => Alert.alert(
    'Reset all playoffs?',
    'All playoff and championship games/results will be removed, including their standings effects. Pool results remain. You can then correct pool results and confirm a new bracket.',
    [{ text: 'Keep playoffs', style: 'cancel' }, { text: 'Reset playoffs', style: 'destructive',
      onPress: () => void onAction({ type: 'reset-playoffs', id: tournament.id }) }],
  )} />;
}

export function TournamentMatchCard({ group, tournament, match, currentPlayerId, busy, onAction }: {
  group: SavedGroup; tournament: Tournament; match: TournamentMatch; currentPlayerId: string; busy: boolean;
  onAction: (action: TournamentAction) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const games = matchGames(group, match);
  const game = currentMatchGame(group, match);
  const wins = matchGameWins(group, match);
  const status = tournamentMatchStatus(group, tournament, match);
  const locked = game?.status === 'pending' && status === 'waiting';
  const yourGame = isCurrentPlayerMatch(group, tournament, match, currentPlayerId);
  useEffect(() => { setError(null); }, [game?.id, game?.status]);
  async function act(action: TournamentAction) {
    setError(null);
    setError(await onAction(action));
  }

  const canReset = group.canManage && games.some(entry => entry.status === 'completed') &&
    (match.stage === 'pool' ? tournament.playoffs.length === 0 : match.id === tournament.playoffs[tournament.playoffs.length - 1]?.id);
  return (
    <View style={[styles.scoreCard, styles.compactScoreCard, yourGame && styles.currentGameCard]}>
      {yourGame && <Text style={styles.currentGameLabel}>Your current game</Text>}
      <Text accessibilityRole="header" style={styles.scoreCardTitle}>{tournamentMatchTitle(tournament, match)}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.scoreNote}>{tournamentMatchStatusLabels[status]}</Text>
      {match.gameIds && <Text accessibilityLiveRegion="polite" style={styles.scoreNote}>
        Series games won: Team A {wins.a}, Team B {wins.b}. First to two wins.
      </Text>}
      {locked && <Text style={styles.scoreNote}>Locked: complete every game in Round {currentPoolRound(group, tournament)} before entering scores for this round.</Text>}
      {match.gameIds && games.filter(entry => entry.id !== game?.id).map(entry => <GameTeamsTable key={entry.id} group={group} game={entry} compact />)}
      {game ? (
        game.status === 'pending' && group.canEdit ? (
          <GameScoreEntry key={game.id} group={group} game={game} busy={busy} disabled={locked} onSave={(scoreA, scoreB) => void act({
            type: 'score', id: tournament.id, matchId: match.id, gameId: game.id, scoreA, scoreB,
          })} />
        ) : <GameTeamsTable group={group} game={game} compact />
      ) : (
        <View style={styles.stack}>
          {(['A', 'B'] as const).map((side) => {
            const id = side === 'A' ? match.teamA : match.teamB;
            return <View key={side} style={styles.stack}>
              <Text style={styles.scoreNote}>Team {side}</Text>
              {id ? teamPlayerLabels(group, requireTeam(tournament, id).players).map((name, index) =>
                <Text key={index} style={styles.compactPlayerName}>{name}</Text>)
                : <Text style={styles.body}>{playoffPlaceholder(tournament, match, side)}</Text>}
            </View>;
          })}
        </View>
      )}
      {match.bye
        ? <Text style={styles.scoreNote}>Bye: advances without a played game or standings win. No score is entered.</Text>
        : <Text style={styles.scoreNote}>{tournamentScoringLabel(match.stage, tournament.scoring)}. Win by two, no cap.</Text>}
      {!game && !match.bye && <Text style={styles.scoreNote}>Waiting for the preceding matches to finish. Score entry opens when both teams are known.</Text>}
      {game?.status === 'pending' && !group.canEdit && <Text style={styles.scoreNote}>A group member will record the result.</Text>}
      <ErrorMessage message={error} />
      {canReset && <Action title={match.gameIds ? 'Clear series to correct scores' : 'Clear result to correct score'} disabled={busy} destructive compact onPress={() => Alert.alert(
        match.gameIds ? 'Clear the entire championship series?' : 'Clear this result?',
        match.gameIds ? 'All scores in this series and their effects on group standings will be removed. The championship will restart at Game 1.'
          : 'The match will await a new score and its effects on group standings will be removed.',
        [{ text: 'Keep result', style: 'cancel' }, { text: match.gameIds ? 'Clear series' : 'Clear result', style: 'destructive',
          onPress: () => void act({ type: 'reset-result', id: tournament.id, matchId: match.id }) }],
      )} />}
    </View>
  );
}
