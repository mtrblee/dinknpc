import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupSummary } from '../../types/api';
import { colors, PageLink, styles } from './ui';
import { GroupAvatar } from './GroupAvatar';
import { formatGroupActivity, sortGroupsByActivity } from '../../domain/timestamps';

export function HomeScreen({
  groups, loaded, canCreate, canSearch, onCreate, onOpenGroups, onOpenGroup, onOpenStats, onSearch,
}: {
  groups: readonly GroupSummary[];
  loaded: boolean;
  canCreate: boolean;
  canSearch: boolean;
  onCreate: () => void;
  onOpenGroups: () => void;
  onOpenGroup: (id: string) => void;
  onOpenStats: () => void;
  onSearch: () => void;
}) {
  const shortcuts = [
    { title: 'Find a public group', detail: 'Ask to join an existing pickleball crew.', onPress: onSearch, disabled: !canSearch },
    { title: 'Individual statistics', detail: 'See your ranking and results in each group.', onPress: onOpenStats, disabled: !loaded },
  ];

  return (
    <View style={home.screen}>
      <View style={home.hero}>
        <Text style={home.eyebrow}>PICKLEBALL, TOGETHER</Text>
        <Text accessibilityRole="header" style={home.title}>Your group.{'\n'}Every game.</Text>
        <Text style={home.intro}>Create a group for your pickleball crew. Keep your games, scores, and standings in one place.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Create a group"
          accessibilityHint="Opens the new group form." accessibilityState={{ disabled: !canCreate }}
          disabled={!canCreate} onPress={onCreate}
          style={({ pressed }) => [home.create, (pressed || !canCreate) && styles.dimmed]}>
          <Text style={home.createLabel}>Create a group</Text>
          <Text accessible={false} allowFontScaling={false} style={home.plus}>+</Text>
        </Pressable>
        <Text style={home.heroNote}>Your group name. Your players. Your game history.</Text>
      </View>

      <View style={styles.section}>
        <View style={home.sectionHeading}>
          <Text accessibilityRole="header" style={[styles.heading, home.sectionTitle]}>Your groups</Text>
          {loaded && <Text accessibilityLabel={`${groups.length} groups created or joined`} style={home.count}>{groups.length}</Text>}
        </View>
        {!loaded ? (
          <Text style={styles.secondary}>Saved groups will appear here after they load. If loading fails, pull down to try again.</Text>
        ) : groups.length === 0 ? (
          <View style={home.empty}>
            <Text style={styles.label}>Make a home for your next game</Text>
            <Text style={styles.body}>Start with Create a group above, or find a public group below and ask to join.</Text>
            <Text style={styles.secondary}>Already know a member? Share your player code from Settings so they can add you.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.secondary}>Open a group to add players, start a game, or see your results.</Text>
            {sortGroupsByActivity(groups).slice(0, 3).map((group) => {
              const completed = group.completedGameCount;
              const activity = formatGroupActivity(group);
              return (
                <Pressable key={group.id} accessibilityRole="button" accessibilityLabel={`Open group ${group.name}. ${activity}`}
                  onPress={() => onOpenGroup(group.id)} style={({ pressed }) => [home.group, pressed && styles.dimmed]}>
                  <GroupAvatar avatar={group.avatar} size={40} />
                  <View style={home.groupCopy}>
                    <Text style={home.groupName}>{group.name}</Text>
                    <Text style={styles.secondary}>
                      {group.playerCount} {group.playerCount === 1 ? 'player' : 'players'} / {completed} completed {completed === 1 ? 'game' : 'games'}
                    </Text>
                    <Text style={home.activity}>{activity}</Text>
                  </View>
                  <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
                </Pressable>
              );
            })}
            {groups.length > 3 && <Text style={styles.secondary}>Showing 3 of {groups.length} groups.</Text>}
            <PageLink title="View all groups" accessibilityLabel="View all my groups" onPress={onOpenGroups} />
          </>
        )}
      </View>

      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.heading}>Explore</Text>
        {shortcuts.map((shortcut) => (
          <Pressable key={shortcut.title} accessibilityRole="button" accessibilityLabel={shortcut.title}
            accessibilityState={{ disabled: shortcut.disabled }} disabled={shortcut.disabled} onPress={shortcut.onPress}
            style={({ pressed }) => [home.shortcut, (pressed || shortcut.disabled) && styles.dimmed]}>
            <View style={home.groupCopy}>
              <Text style={styles.label}>{shortcut.title}</Text>
              <Text style={styles.secondary}>{shortcut.detail}</Text>
            </View>
            <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const home = StyleSheet.create({
  screen: { gap: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hero: { padding: 22, gap: 14, borderRadius: 24, backgroundColor: colors.hero },
  eyebrow: { color: colors.highlight, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { color: colors.surface, fontSize: 34, fontWeight: '800' },
  intro: { color: colors.onHero, fontSize: 16 },
  create: { minHeight: 50, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: 12, borderRadius: 14, backgroundColor: colors.highlight, marginTop: 4 },
  createLabel: { color: colors.foreground, fontSize: 16, fontWeight: '800', flex: 1 },
  plus: { color: colors.foreground, fontSize: 26 },
  heroNote: { color: colors.onHero, fontSize: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { flexShrink: 1 },
  count: { backgroundColor: colors.selected, color: colors.primary, fontSize: 14, fontWeight: '700',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  empty: { padding: 16, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.surface },
  group: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder, borderLeftWidth: 4,
    borderLeftColor: colors.primary, borderRadius: 16 },
  groupCopy: { flex: 1, minWidth: 0, gap: 6 },
  groupName: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  activity: { color: colors.primary, fontSize: 12, lineHeight: 17 },
  shortcut: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.softBorder },
});
