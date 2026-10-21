import { useState } from 'react';
import { Text, View } from 'react-native';
import { addPlayer, formatMoney, getStandings, ValidationError } from '../../domain/groups';
import type { Group } from '../../types/groups';
import { GameHistory } from './GameHistory';
import { GameSetup } from './GameSetup';
import { Action, ErrorMessage, Field, styles } from './ui';

export function GroupScreen({ group, onUpdate }: { group: Group; onUpdate: (group: Group) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const standings = getStandings(group);

  function submitPlayer() {
    try {
      onUpdate(addPlayer(group, name));
      setName('');
      setError(null);
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      setError(caught.message);
    }
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{group.name}</Text>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Players ({group.players.length})</Text>
        <Text style={styles.body}>
          {group.players.length ? group.players.map((player) => player.name).join(', ') : 'No players yet.'}
        </Text>
        <Field label="Player name" value={name} onChangeText={setName} autoCapitalize="words" />
        <ErrorMessage message={error} />
        <Action title="Add player" onPress={submitPlayer} />
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Individual standings</Text>
        <Text style={styles.secondary}>
          Ranked by wins, then point differential. Ties share a rank. Players without games are unranked.
        </Text>
        <Text style={styles.secondary}>Money is a simulated net result, not a balance or amount paid.</Text>
        {standings.length === 0 && <Text style={styles.body}>Add players to see standings.</Text>}
        {standings.map((row) => (
          <View key={row.player.id} style={styles.card}>
            <Text style={styles.label}>
              {row.rank === null ? 'Unranked' : `#${row.rank}`} - {row.player.name}
            </Text>
            <Text style={styles.body}>{row.wins} wins / {row.losses} losses</Text>
            <Text style={styles.body}>
              Point differential: {row.pointDifferential > 0 ? '+' : ''}{row.pointDifferential}
            </Text>
            <Text style={styles.body}>
              Simulated net (USD): {row.moneyCents > 0 ? '+' : ''}{formatMoney(row.moneyCents)}
            </Text>
          </View>
        ))}
      </View>
      <GameSetup group={group} onUpdate={onUpdate} />
      <GameHistory group={group} onUpdate={onUpdate} />
    </View>
  );
}
