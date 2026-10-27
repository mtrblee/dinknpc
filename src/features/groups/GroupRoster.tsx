import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getAvatar } from '../../domain/avatars';
import { getPlayerDisplayName, getPlayerLabel, getPlayerReference } from '../../domain/groups';
import { sortPlayersByRole } from '../../domain/groupRoles';
import type { Player } from '../../types/groups';
import type { SavedGroup } from '../../types/api';
import { colors, PlayerAvatar, styles } from './ui';

export function GroupRoster({ group, players = group.players, onRemove, busy = false }: {
  group: SavedGroup; players?: readonly Player[]; onRemove?: (player: Player) => void; busy?: boolean;
}) {
  return (
    <View style={roster.table}>
      <View style={[roster.row, roster.header]}>
        <View style={roster.avatarColumn} />
        <Text style={[roster.headerText, roster.nameColumn]}>Name</Text>
        {onRemove && <View style={roster.removeColumn} />}
      </View>
      {sortPlayersByRole(group, players).map((player, index) => (
        <View key={player.id} style={[roster.row, index % 2 === 1 && roster.alternate, index > 0 && roster.divider]}>
          <View style={roster.avatarColumn} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <PlayerAvatar avatar={player.avatar} size={24} />
          </View>
          <View style={roster.nameColumn} accessible
            accessibilityLabel={`${getPlayerLabel(group, player)}, ${getAvatar(player.avatar).label} avatar${player.id === group.ownerId ? ', Owner' : group.adminIds.includes(player.id) ? ', Admin' : ''}`}>
            <View style={roster.nameLine}>
              <Text style={roster.name}>{getPlayerDisplayName(player)}</Text>
              {player.id === group.ownerId ? <Text style={roster.role}>Owner</Text>
                : group.adminIds.includes(player.id) && <Text style={roster.role}>Admin</Text>}
            </View>
            {getPlayerLabel(group, player) !== getPlayerDisplayName(player) && <Text style={roster.id}>{getPlayerReference(player)}</Text>}
          </View>
          {onRemove && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${getPlayerLabel(group, player)}`}
              accessibilityHint="Asks for confirmation. Players in games or tournaments cannot be removed."
              accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onRemove(player)}
              style={({ pressed }) => [roster.removeColumn, roster.removeButton, (busy || pressed) && styles.dimmed]}>
              <Text style={roster.removeLabel}>Remove</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

const roster = StyleSheet.create({
  table: { borderWidth: 1, borderColor: colors.softBorder, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 2, minHeight: 32 },
  header: { backgroundColor: colors.hero, minHeight: 28 },
  headerText: { fontSize: 12, fontWeight: '700', color: colors.surface },
  avatarColumn: { width: 26, alignItems: 'center' },
  removeColumn: { minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  removeButton: { minHeight: 44, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1,
    borderColor: colors.error, backgroundColor: colors.surface },
  removeLabel: { fontSize: 12, fontWeight: '600', color: colors.error },
  nameColumn: { flex: 1, minWidth: 0, gap: 1 },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 1 },
  name: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.foreground },
  id: { fontSize: 11, lineHeight: 15, color: colors.secondary },
  role: { fontSize: 10, fontWeight: '700', color: colors.primary },
  alternate: { backgroundColor: colors.rowTint },
  divider: { borderTopWidth: 1, borderTopColor: colors.softBorder },
});
