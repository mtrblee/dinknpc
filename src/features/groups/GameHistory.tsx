import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { deleteGame, formatMoney, recordResult, ValidationError } from '../../domain/groups';
import type { Game, Group, PendingGame } from '../../types/groups';
import { Action, ErrorMessage, Field, styles, teamNames } from './ui';

function ResultEntry({
  group, game, onUpdate,
}: { group: Group; game: PendingGame; onUpdate: (group: Group) => void }) {
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    try {
      onUpdate(recordResult(group, game.id, scoreA, scoreB));
      setError(null);
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      setError(caught.message);
    }
  }

  return (
    <View style={styles.stack}>
      <Field label="Team A final score" value={scoreA} onChangeText={setScoreA} keyboardType="number-pad" />
      <Field label="Team B final score" value={scoreB} onChangeText={setScoreB} keyboardType="number-pad" />
      <ErrorMessage message={error} />
      <Action title="Save final result" onPress={submit} />
    </View>
  );
}

function GameCard({
  group, game, onUpdate,
}: { group: Group; game: Game; onUpdate: (group: Group) => void }) {
  const [error, setError] = useState<string | null>(null);
  const pending = game.status === 'pending';

  function confirmDelete() {
    Alert.alert(
      pending ? 'Cancel this game?' : 'Delete this result?',
      pending
        ? 'The pending game will be removed. Standings will not change.'
        : 'This cannot be undone. All wins, losses, points and simulated money will be recalculated.',
      [
        { text: 'Keep game', style: 'cancel' },
        {
          text: pending ? 'Cancel game' : 'Delete result',
          style: 'destructive',
          onPress: () => {
            try {
              onUpdate(deleteGame(group, game.id));
            } catch (caught) {
              if (!(caught instanceof ValidationError)) throw caught;
              setError(caught.message);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{pending ? 'Awaiting result' : 'Completed game'}</Text>
      <Text style={styles.body}>Team A: {teamNames(group, game.teamA)}</Text>
      <Text style={styles.body}>Team B: {teamNames(group, game.teamB)}</Text>
      <Text style={styles.secondary}>Simulated wager: {formatMoney(game.wagerCents)} USD per player</Text>
      {game.status === 'completed' ? (
        <Text style={styles.body}>
          Final: {game.scoreA} - {game.scoreB}. Team {game.scoreA > game.scoreB ? 'A' : 'B'} won.
        </Text>
      ) : (
        <ResultEntry group={group} game={game} onUpdate={onUpdate} />
      )}
      <ErrorMessage message={error} />
      <Action
        title={pending ? 'Cancel game' : 'Delete result'}
        onPress={confirmDelete}
        destructive
      />
    </View>
  );
}

export function GameHistory({ group, onUpdate }: { group: Group; onUpdate: (group: Group) => void }) {
  const pending = group.games.filter((game) => game.status === 'pending');
  const completed = group.games.filter((game) => game.status === 'completed').reverse();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Games</Text>
      {group.games.length === 0 && <Text style={styles.body}>No games yet. Set up the first one above.</Text>}
      {[...pending, ...completed].map((game) =>
        <GameCard key={game.id} group={group} game={game} onUpdate={onUpdate} />)}
    </View>
  );
}
