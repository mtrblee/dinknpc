import { Alert, Pressable, Text, View } from 'react-native';
import type { Game } from '../../types/groups';
import type { SavedGroup } from '../../types/api';
import type { GroupsApi } from '../../services/groupsApi';
import { Action, ErrorMessage, styles, teamNames } from './ui';
import { formatActivityTimestamp } from '../../domain/timestamps';
import { useGroupMutation } from './useGroupMutation';
import { GameScoreEntry, GameTeamsTable } from './GameTeamsTable';

export function GameCard({
  group, game, api, onUpdate, onOpenTournament,
}: {
  group: SavedGroup; game: Game; api: GroupsApi; onUpdate: (group: SavedGroup) => void;
  onOpenTournament?: (id: string) => void;
}) {
  const { busy, error, run } = useGroupMutation(group, api, onUpdate);
  const pending = game.status === 'pending';
  const tournament = game.tournament;
  const cardStyle = [styles.scoreCard, !pending && styles.compactScoreCard];

  function confirmDelete() {
    Alert.alert(
      pending ? 'Cancel this game?' : 'Delete this result?',
      pending
        ? 'The pending game will be removed. Standings will not change.'
        : 'This cannot be undone. All group standings will be recalculated.',
      [
        { text: 'Keep game', style: 'cancel' },
        {
          text: pending ? 'Cancel game' : 'Delete result',
          style: 'destructive',
          onPress: () => void run({ type: 'delete-game', gameId: game.id }),
        },
      ],
    );
  }

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[styles.scoreCardTitle, { flex: 1 }]}>{pending ? 'In progress - awaiting result' : 'Completed game'}</Text>
        {!pending && tournament && onOpenTournament && <View style={styles.chevron} />}
      </View>
      {game.status === 'pending' && group.canEdit && !tournament ? (
        <GameScoreEntry group={group} game={game} busy={busy}
          onSave={(scoreA, scoreB) => void run({ type: 'record-result', gameId: game.id, scoreA, scoreB })} />
      ) : <GameTeamsTable group={group} game={game} compact={!pending} />}
      {pending && (!group.canEdit || tournament) && <Text style={styles.scoreNote}>A group member will record the result.</Text>}
      <ErrorMessage message={error} />
      {pending && tournament && onOpenTournament && (
        <Action title="View tournament" onPress={() => onOpenTournament(tournament.id)} compact />
      )}
      {group.canManage && !game.tournament && (
        <Action title={pending ? 'Cancel game' : 'Delete result'} onPress={confirmDelete} disabled={busy} destructive compact />
      )}
    </>
  );

  if (game.status === 'completed' && tournament && onOpenTournament) {
    const winner = game.scoreA > game.scoreB ? game.teamA : game.teamB;
    return (
      <Pressable accessibilityRole="button"
        accessibilityLabel={`Completed tournament ${tournament.stage} game${tournament.gameNumber ? ` ${tournament.gameNumber}` : ''}. ${teamNames(group, game.teamA)}: ${game.scoreA}. ${teamNames(group, game.teamB)}: ${game.scoreB}. Winner: ${teamNames(group, winner)}. ${formatActivityTimestamp(true, game)}.`}
        accessibilityHint="Opens this game's tournament." onPress={() => onOpenTournament(tournament.id)}
        style={({ pressed }) => [cardStyle, pressed && styles.dimmed]}>
        <View style={{ gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {content}
        </View>
      </Pressable>
    );
  }
  return <View style={cardStyle}>{content}</View>;
}
