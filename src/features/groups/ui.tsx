import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { getPlayerDisplayName, getPlayerLabel, getPlayerReference } from '../../domain/groups';
import type { Group, Player, Team } from '../../types/groups';
import { getAvatar } from '../../domain/avatars';
import type { AvatarId } from '../../domain/avatars';
import { requireTeam } from '../../domain/tournaments';
import type { Tournament } from '../../types/tournaments';

export type RefreshHandle = { refresh: () => Promise<void> };

export const tournamentMatchStatusLabels = {
  ready: 'Ready to play', waiting: 'Waiting', completed: 'Completed', bye: 'Advances by bye',
} as const;

export const colors = {
  background: '#FCF7F2',
  surface: '#FFFFFF',
  foreground: '#43291D',
  secondary: '#715344',
  primary: '#A54516',
  hero: '#843716',
  heroAccent: '#9A441E',
  heroBorder: '#C57D56',
  onHero: '#FFE9DA',
  highlight: '#FFD5B5',
  border: '#B17D5F',
  selected: '#FAE4D6',
  warning: '#FFF1C7',
  error: '#A32424',
  accent: '#3656A1',
  accentSurface: '#EDF1FF',
  positiveSurface: '#FBE1CC',
  winner: '#3F6B4E',
  winnerSurface: '#EDF4EE',
  softBorder: '#E7D3C5',
  rowTint: '#F8F0E9',
};

const signedStyles = StyleSheet.create({
  badge: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 5 },
  positive: { color: '#236541', backgroundColor: '#E1F5E7' },
  negative: { color: '#9A3030', backgroundColor: '#FBE3E3' },
  neutral: { color: colors.secondary, backgroundColor: '#F1ECE7' },
});

export function signedTone(value: number) {
  return [signedStyles.badge, value > 0 ? signedStyles.positive : value < 0 ? signedStyles.negative : signedStyles.neutral];
}

export function BackButton({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back"
      accessibilityHint="Returns to the previous page." accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.backButton, (pressed || disabled) && styles.dimmed]}>
      <View style={styles.backIcon} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.backChevron} />
      </View>
    </Pressable>
  );
}

export function Action({
  title, onPress, disabled = false, selected = false, destructive = false, compact = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  destructive?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compactButton,
        selected && styles.selected,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text style={[styles.buttonText, destructive && styles.error, compact && styles.compactButtonText]}>{title}</Text>
    </Pressable>
  );
}

export function PageLink({ title, accessibilityLabel, onPress }: {
  title: string; accessibilityLabel: string; onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens a separate page."
      onPress={onPress}
      style={({ pressed }) => [styles.pageLink, pressed && styles.dimmed]}
    >
      <Text style={styles.pageLinkText}>{title}</Text>
      <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
    </Pressable>
  );
}

export function LeaderboardLink({ groupName, onPress }: { groupName: string; onPress: () => void }) {
  return <PageLink title="View leaderboard" accessibilityLabel={`View leaderboard for ${groupName}`} onPress={onPress} />;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.secondary}
        style={styles.input}
      />
    </View>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
      {message}
    </Text>
  ) : null;
}

export function teamPlayerLabels(group: Group, team: Team): string[] {
  return team.map((id) => {
    const player = group.players.find((entry) => entry.id === id);
    if (!player) throw new Error(`Game references missing player ${id}.`);
    return getPlayerLabel(group, player);
  });
}

export function teamNames(group: Group, team: Team): string {
  return teamPlayerLabels(group, team).join(' / ');
}

export function tournamentTeamLabel(group: Group, tournament: Tournament, id: string): string {
  return `${id.replace('team-', 'Team ')}: ${teamNames(group, requireTeam(tournament, id).players)}`;
}

export function PlayerAvatar({ avatar, size = 36 }: { avatar?: AvatarId; size?: number }) {
  const option = getAvatar(avatar);
  return (
    <View style={{ width: size, minHeight: size, borderRadius: size / 2, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center' }}>
      <Text accessibilityLabel={`${option.label} avatar`} allowFontScaling={false} style={{ fontSize: size * 0.65 }}>{option.emoji}</Text>
    </View>
  );
}

export function PlayerName({ group, player, compact = false }: { group: Group; player: Player; compact?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: compact ? 26 : 36, justifyContent: 'center' }}>
      <Text style={compact ? styles.compactPlayerName : styles.body}>{getPlayerDisplayName(player)}</Text>
      {getPlayerLabel(group, player) !== getPlayerDisplayName(player) && <Text style={compact ? styles.compactPlayerId : styles.secondary}>{getPlayerReference(player)}</Text>}
    </View>
  );
}

export function PlayerChoiceGrid({ group, context, selected, isDisabled, onToggle }: {
  group: Group; context: string; selected: readonly string[];
  isDisabled: (id: string) => boolean; onToggle: (id: string) => void;
}) {
  const players = group.players.filter((player) => !player.isDeleted);
  return (
    <View style={styles.playerGrid}>
      {players.filter((_, index) => index % 2 === 0).map((first, row) => (
        <View key={first.id} style={styles.playerGridRow}>
          {players.slice(row * 2, row * 2 + 2).map((player) => (
            <View key={player.id} style={styles.playerGridCell}>
              <PlayerChoice group={group} player={player} context={context}
                checked={selected.includes(player.id)} disabled={isDisabled(player.id)} onPress={() => onToggle(player.id)} />
            </View>
          ))}
          {!players[row * 2 + 1] && <View style={styles.playerGridCell} />}
        </View>
      ))}
    </View>
  );
}

function PlayerChoice({ group, player, context, checked, disabled, onPress }: {
  group: Group; player: Player; context: string; checked: boolean; disabled: boolean; onPress: () => void;
}) {
  return (
    <Pressable accessible accessibilityRole="checkbox"
      accessibilityLabel={`${getPlayerLabel(group, player)}, ${context}, ${getAvatar(player.avatar).label} avatar`}
      accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.button, styles.playerRow, styles.playerTile,
        checked && styles.selected, checked && styles.checkedPlayerChoice, (pressed || disabled) && styles.dimmed,
      ]}>
      <PlayerAvatar avatar={player.avatar} size={22} />
      <PlayerName group={group} player={player} compact />
      <View style={[styles.choiceBox, checked && styles.checkedChoiceBox]} accessible={false}>
        {checked && <View style={styles.choiceTick} />}
      </View>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  stack: { gap: 8 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkedPlayerChoice: { borderColor: colors.primary },
  compactPlayerName: { color: colors.foreground, fontSize: 12, fontWeight: '600' },
  compactPlayerId: { color: colors.secondary, fontSize: 10 },
  playerGrid: { gap: 6 },
  playerGridRow: { flexDirection: 'row', gap: 6 },
  playerGridCell: { flex: 1, minWidth: 0 },
  playerTile: { flex: 1, minHeight: 44, paddingVertical: 4, paddingHorizontal: 6, gap: 6,
    borderColor: colors.softBorder, backgroundColor: colors.surface },
  choiceBox: { width: 14, height: 14, borderWidth: 1, borderRadius: 4, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center' },
  checkedChoiceBox: { backgroundColor: colors.primary },
  choiceTick: { width: 5, height: 8, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.surface,
    transform: [{ rotate: '45deg' }], marginTop: -2 },
  section: { gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  compactForm: { padding: 12, gap: 8, borderRadius: 14, borderWidth: 1,
    borderColor: colors.softBorder, backgroundColor: colors.surface },
  compactFormTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.foreground },
  compactFormRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  compactFormInput: { flexGrow: 1, flexBasis: 140, minWidth: 120, minHeight: 44, paddingVertical: 8, paddingHorizontal: 10,
    fontSize: 14, color: colors.foreground, borderWidth: 1, borderColor: colors.softBorder,
    borderRadius: 8, backgroundColor: colors.surface },
  scoreCard: {
    backgroundColor: colors.surface,
    borderColor: colors.softBorder,
    borderWidth: 1,
    borderTopWidth: 3,
    borderTopColor: colors.primary,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  scoreCardTitle: { fontSize: 13, fontWeight: '700', color: colors.primary },
  compactScoreCard: { width: '92%', maxWidth: 360, alignSelf: 'center', padding: 8 },
  currentGameCard: { borderWidth: 2, borderColor: colors.accent, borderTopColor: colors.accent },
  currentGameLabel: { alignSelf: 'flex-start', color: colors.accent, backgroundColor: colors.accentSurface,
    fontSize: 12, fontWeight: '700', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  scoreNote: { fontSize: 12, lineHeight: 16, color: colors.secondary },
  title: { fontSize: 30, fontWeight: '700', color: colors.foreground },
  heading: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  label: { fontSize: 16, fontWeight: '600', color: colors.foreground },
  body: { fontSize: 16, color: colors.foreground },
  secondary: { fontSize: 14, color: colors.secondary },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    color: colors.foreground,
    backgroundColor: colors.surface,
    fontSize: 16,
  },
  button: {
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { color: colors.primary, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  compactButton: { minHeight: 44, paddingVertical: 6, paddingHorizontal: 10 },
  compactButtonText: { fontSize: 14 },
  backButton: { width: 44, height: 44, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  backIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.selected,
    alignItems: 'center', justifyContent: 'center' },
  backChevron: { width: 9, height: 9, borderLeftWidth: 2, borderBottomWidth: 2,
    borderColor: colors.primary, transform: [{ rotate: '45deg' }], marginLeft: 4 },
  pageLink: {
    backgroundColor: colors.selected,
    borderRadius: 8,
    padding: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pageLinkText: { color: colors.primary, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  chevron: {
    width: 8,
    height: 8,
    marginRight: 4,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  selected: { backgroundColor: colors.selected },
  dimmed: { opacity: 0.55 },
  error: { fontSize: 16, color: colors.error },
  notice: {
    backgroundColor: colors.warning,
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
});
