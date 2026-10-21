import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { startGame, ValidationError } from '../../domain/groups';
import type { Group } from '../../types/groups';
import { Action, ErrorMessage, Field, styles } from './ui';

export function GameSetup({ group, onUpdate }: { group: Group; onUpdate: (group: Group) => void }) {
  const [teamA, setTeamA] = useState<readonly string[]>([]);
  const [teamB, setTeamB] = useState<readonly string[]>([]);
  const [wager, setWager] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    try {
      const updated = startGame(group, teamA, teamB, wager);
      onUpdate(updated);
      setTeamA([]);
      setTeamB([]);
      setWager('');
      setError(null);
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      setError(caught.message);
    }
  }

  const teams = [
    { label: 'Team A', selected: teamA, other: teamB, set: setTeamA },
    { label: 'Team B', selected: teamB, other: teamA, set: setTeamB },
  ];

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Set up a doubles game</Text>
      <Text style={styles.secondary}>
        Select two players per team. Starting locks the teams and simulated wager before score entry.
      </Text>
      {group.players.length < 4 ? (
        <Text style={styles.body}>Add at least four players to start a game.</Text>
      ) : (
        <>
          {teams.map((team) => (
            <View key={team.label} style={styles.stack}>
              <Text style={styles.label}>{team.label} ({team.selected.length}/2)</Text>
              {group.players.map((player) => {
                const checked = team.selected.includes(player.id);
                const disabled = team.other.includes(player.id) || (!checked && team.selected.length === 2);
                return (
                  <Pressable
                    key={player.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${player.name}, ${team.label}`}
                    accessibilityState={{ checked, disabled }}
                    disabled={disabled}
                    onPress={() => team.set(checked
                      ? team.selected.filter((id) => id !== player.id)
                      : [...team.selected, player.id])}
                    style={[
                      styles.button,
                      checked && styles.selected,
                      disabled && styles.dimmed,
                    ]}
                  >
                    <Text style={styles.body}>{checked ? 'Selected: ' : ''}{player.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Field
            label="Simulated wager per player (USD)"
            value={wager}
            onChangeText={setWager}
            keyboardType="decimal-pad"
            placeholder="For example: 5.00 (or 0 for no wager)"
          />
          <Text style={styles.secondary}>
            Each winner gains this amount; each loser loses it. No real money moves.
          </Text>
          <ErrorMessage message={error} />
          <Action title="Start game" onPress={submit} />
        </>
      )}
    </View>
  );
}
