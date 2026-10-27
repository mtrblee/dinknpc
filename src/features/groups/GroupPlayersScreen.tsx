import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { getPlayerLabel } from '../../domain/groups';
import type { GroupsApi } from '../../services/groupsApi';
import type { SavedGroup } from '../../types/api';
import type { Player } from '../../types/groups';
import { Action, colors, ErrorMessage, styles } from './ui';
import { useGroupMutation } from './useGroupMutation';
import { GuestPlayerForm } from './GuestPlayerForm';
import { GroupRoster } from './GroupRoster';

export function GroupPlayersScreen({ group, api, onUpdate }: {
  group: SavedGroup; api: GroupsApi; onUpdate: (group: SavedGroup) => void;
}) {
  const [playerId, setPlayerId] = useState('');
  const { busy, error, run } = useGroupMutation(group, api, onUpdate);

  function confirmRemove(player: Player) {
    Alert.alert(
      `Remove ${getPlayerLabel(group, player)}?`,
      player.isDeleted
        ? 'This deletes the unused anonymous roster record, not a registered account. Entries used in any game or tournament cannot be removed.'
        : player.isGuest
        ? 'This permanently deletes the guest record. Players used in any game or tournament cannot be removed.'
        : 'This removes the player from this group only, not their account or other groups. Players used in any game or tournament cannot be removed. Group ownership does not change.',
      [
        { text: 'Keep player', style: 'cancel' },
        { text: 'Remove player', style: 'destructive',
          onPress: () => void run({ type: 'remove-player', playerId: player.id }) },
      ],
    );
  }

  return (
    <View style={roster.screen}>
      <View style={roster.heading}>
        <Text accessibilityRole="header" style={roster.title}>View players</Text>
        <Text style={roster.note}>{group.name}</Text>
      </View>
      {group.canEdit && (
        <View style={styles.compactForm}>
          <Text accessibilityRole="header" style={styles.compactFormTitle}>Add a player</Text>
          <View style={styles.compactFormRow}>
            <TextInput accessibilityLabel="Player code" value={playerId} onChangeText={setPlayerId}
              placeholder="K7M2Q9" placeholderTextColor={colors.secondary} style={styles.compactFormInput}
              autoCapitalize="characters" autoCorrect={false} editable={!busy} />
            <Action title="Add player" compact disabled={busy}
              onPress={() => void run({ type: 'add-player', playerId }, () => setPlayerId(''))} />
          </View>
          <Text style={roster.note}>Use a verified player's code from Settings. Full player IDs also work.</Text>
        </View>
      )}
      {group.canManage && <GuestPlayerForm busy={busy} onAdd={(name) => run({ type: 'add-guest', name })} />}
      {busy && <Text accessibilityLiveRegion="polite" style={roster.note}>Saving changes...</Text>}
      <ErrorMessage message={error} />
      <View style={roster.list}>
        <Text accessibilityRole="header" style={styles.compactFormTitle}>Players ({group.players.length})</Text>
        {group.players.length ? (
          <GroupRoster group={group} onRemove={group.canManage ? confirmRemove : undefined} busy={busy} />
        ) : <Text style={roster.note}>{group.canManage
          ? 'No players yet. Add a registered player or guest above.'
          : 'No players yet. Add a registered player above.'}</Text>}
        <Text style={roster.note}>Guests have (g) before their name. Pull down for the latest roster.</Text>
        {!group.canManage && <Text style={roster.note}>Only the owner and admins can add guests or remove players.</Text>}
        {group.players.some((player) => player.isDeleted) && <Text style={roster.note}>Deleted player entries preserve shared history only and cannot be selected for new games or tournaments.</Text>}
      </View>
    </View>
  );
}

const roster = StyleSheet.create({
  screen: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
  heading: { gap: 3 },
  title: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  list: { gap: 8 },
  note: { fontSize: 12, lineHeight: 17, color: colors.secondary },
});
