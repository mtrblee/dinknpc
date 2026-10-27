import { Text, View } from 'react-native';
import type { SavedGroup } from '../../types/api';
import type { GroupsApi } from '../../services/groupsApi';
import { styles } from './ui';
import { GameCard } from './GameCard';

export function GameHistory({ group, api, onUpdate, onOpenTournament }: {
  group: SavedGroup; api: GroupsApi; onUpdate: (group: SavedGroup) => void; onOpenTournament: (id: string) => void;
}) {
  const completed = group.games.filter((game) => game.status === 'completed').reverse();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>History</Text>
      {completed.length === 0 && <Text style={styles.body}>No completed games yet.</Text>}
      {completed.map((game) =>
        <GameCard key={game.id} group={group} game={game} api={api} onUpdate={onUpdate} onOpenTournament={onOpenTournament} />)}
    </View>
  );
}
