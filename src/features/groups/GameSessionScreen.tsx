import { Text, View } from 'react-native';
import type { GroupsApi } from '../../services/groupsApi';
import type { SavedGroup } from '../../types/api';
import { GameCard } from './GameCard';
import { GameSetup } from './GameSetup';
import { styles } from './ui';

export function GameSessionScreen({ group, api, onUpdate }: {
  group: SavedGroup; api: GroupsApi; onUpdate: (group: SavedGroup) => void;
}) {
  const pending = group.games.filter((game) => game.status === 'pending' && !game.tournament);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>Doubles games</Text>
      <Text style={styles.heading}>{group.name}</Text>
      <Text style={styles.secondary}>
        Start a new game, then enter final scores in the in-progress section below.
        Completed results appear in your group's History. Pull down to refresh games.
        {' '}Tournament matches are scored on their tournament page.
      </Text>
      {group.canEdit && <GameSetup group={group} api={api} onUpdate={onUpdate} />}
      <Text accessibilityRole="header" style={styles.heading}>In-progress games</Text>
      {pending.length === 0 && <Text style={styles.body}>No games in progress.</Text>}
      {pending.map((game) => <GameCard key={game.id} group={group} game={game} api={api} onUpdate={onUpdate} />)}
    </View>
  );
}
