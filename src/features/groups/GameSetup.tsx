import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { SavedGroup } from '../../types/api';
import type { GroupsApi } from '../../services/groupsApi';
import { Action, ErrorMessage, Field, PlayerChoiceGrid, styles } from './ui';
import { useGroupMutation } from './useGroupMutation';
import { currencySymbol } from '../../domain/groups';

export function GameSetup({ group, api, onUpdate }: { group: SavedGroup; api: GroupsApi; onUpdate: (group: SavedGroup) => void }) {
  const [teamA, setTeamA] = useState<readonly string[]>([]);
  const [teamB, setTeamB] = useState<readonly string[]>([]);
  const [wager, setWager] = useState('');
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const { busy, error, run } = useGroupMutation(group, api, onUpdate);

  useEffect(() => {
    const present = (id: string) => group.players.some((player) => player.id === id && !player.isDeleted);
    if (teamA.every(present) && teamB.every(present)) return;
    setTeamA(teamA.filter(present));
    setTeamB(teamB.filter(present));
    setSelectionError('A selected player was removed from the group. Choose a replacement.');
  }, [group.players, teamA, teamB]);

  function submit() {
    void run({ type: 'start-game', teamA, teamB, wager: group.currency === 'none' ? '0' : wager }, () => {
      setTeamA([]);
      setTeamB([]);
      setWager('');
      setSelectionError(null);
    });
  }

  const teams = [
    { label: 'Team A', selected: teamA, other: teamB, set: setTeamA },
    { label: 'Team B', selected: teamB, other: teamA, set: setTeamB },
  ];

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Set up a doubles game</Text>
      <Text style={styles.secondary}>
        Select two players per team. Starting locks the teams{group.currency !== 'none' ? ' and simulated wager' : ''} before score entry.
      </Text>
      <Text style={styles.scoreNote}>The owner or an admin can add guests in Group settings &gt; View players before setup.</Text>
      <ErrorMessage message={error} />
      <ErrorMessage message={selectionError} />
      {group.players.filter((player) => !player.isDeleted).length < 4 ? (
        <Text style={styles.body}>Add at least four players to start a game.</Text>
      ) : (
        <>
          {teams.map((team) => (
            <View key={team.label} style={{ gap: 4 }}>
              <Text style={styles.label}>{team.label} ({team.selected.length}/2)</Text>
              <PlayerChoiceGrid group={group} context={team.label} selected={team.selected}
                isDisabled={(id) => busy || team.other.includes(id) || (!team.selected.includes(id) && team.selected.length === 2)}
                onToggle={(id) => { setSelectionError(null); team.set(team.selected.includes(id)
                  ? team.selected.filter((entry) => entry !== id) : [...team.selected, id]); }} />
            </View>
          ))}
          {group.currency !== 'none' && (
            <>
              <Field label={`Simulated wager per player (${currencySymbol(group.currency)})`}
                value={wager} onChangeText={setWager} keyboardType="number-pad"
                editable={!busy} placeholder="0" />
              <Text style={styles.secondary}>
                {group.currency === 'money' ? 'Whole USD dollars only. Minimum bet: $1. No cents.' : 'Whole bobas only.'}
                {' '}Leave blank for 0. Each winner gains this amount; each loser loses it. Tracking only, not a payment or amount owed.
              </Text>
            </>
          )}
          <Action title={busy ? 'Saving...' : 'Start game'} onPress={submit} disabled={busy} />
        </>
      )}
    </View>
  );
}
