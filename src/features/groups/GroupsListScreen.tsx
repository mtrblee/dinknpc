import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupSummary } from '../../types/api';
import { colors, styles } from './ui';
import { GroupAvatar } from './GroupAvatar';
import { formatGroupActivity } from '../../domain/timestamps';

export function GroupsListScreen({ groups, loaded, canCreate, onCreate, onOpen }: {
  groups: readonly GroupSummary[];
  loaded: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const [cardSize, setCardSize] = useState(140);
  const sections = [
    { title: 'Groups you own', groups: groups.filter((group) => group.isOwner),
      empty: 'You have not created a group yet. Create one to bring your crew together.' },
    { title: 'Groups you joined', groups: groups.filter((group) => !group.isOwner),
      empty: 'Find a public group in Search, or share your player code with a member.' },
  ];

  return (
    <View style={grid.screen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Create a new group"
        accessibilityState={{ disabled: !canCreate }} disabled={!canCreate} onPress={onCreate}
        style={({ pressed }) => [grid.create, (pressed || !canCreate) && styles.dimmed]}>
        <View style={grid.addIcon} accessible={false}>
          <Text style={grid.plus} allowFontScaling={false}>+</Text>
        </View>
        <View style={grid.createCopy}>
          <Text style={grid.createTitle}>Create a new group</Text>
          <Text style={grid.createCaption}>Bring your crew together.</Text>
        </View>
      </Pressable>
      <Text style={styles.secondary}>Pick a group to see players, games, and tournaments.</Text>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
          {loaded && section.groups.length === 0 && (
            <View style={styles.card}>
              <Text style={styles.body}>{section.empty}</Text>
            </View>
          )}
          {section.groups.length > 0 && (
            <View style={grid.rows} onLayout={(event) => setCardSize(Math.max(140, (event.nativeEvent.layout.width - 12) / 2))}>
              {section.groups.filter((_, index) => index % 2 === 0).map((first, index) => (
                <View key={first.id} style={grid.row}>
                  {section.groups.slice(index * 2, index * 2 + 2).map((group, column) => (
                    <View key={group.id} style={grid.cell}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Open group ${group.name}. ${formatGroupActivity(group)}`}
                        onPress={() => onOpen(group.id)}
                        style={({ pressed }) => [grid.card, { minHeight: cardSize },
                          column === 1 && grid.alternateCard, pressed && styles.dimmed]}>
                        <View style={grid.cardTop} accessible={false} importantForAccessibility="no-hide-descendants">
                          <GroupAvatar avatar={group.avatar} />
                          <View style={styles.chevron} />
                        </View>
                        <View style={grid.copy}>
                          <Text style={grid.name}>{group.name}</Text>
                          <Text style={grid.caption}>{group.playerCount} {group.playerCount === 1 ? 'player' : 'players'}</Text>
                          <Text style={grid.activity}>{formatGroupActivity(group)}</Text>
                        </View>
                      </Pressable>
                    </View>
                  ))}
                  {!section.groups[index * 2 + 1] && <View style={grid.cell} />}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const grid = StyleSheet.create({
  screen: { gap: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  create: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderRadius: 22,
    backgroundColor: colors.hero, borderWidth: 1, borderColor: colors.primary },
  addIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.highlight,
    alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 30, color: colors.foreground, lineHeight: 34 },
  createCopy: { flex: 1, gap: 6 },
  createTitle: { fontSize: 20, fontWeight: '800', color: colors.surface },
  createCaption: { fontSize: 13, color: colors.onHero },
  rows: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1, minWidth: 0 },
  card: { flex: 1, minWidth: 0, padding: 16, gap: 12, borderRadius: 22, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.selected, justifyContent: 'space-between' },
  alternateCard: { backgroundColor: '#EDF1FA', borderColor: '#D5DEEE' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 19, fontWeight: '800', color: colors.foreground },
  caption: { fontSize: 12, color: colors.secondary },
  copy: { gap: 4 },
  activity: { fontSize: 11, lineHeight: 16, color: colors.secondary },
});
