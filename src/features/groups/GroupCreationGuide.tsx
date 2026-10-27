import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ui';

const steps = [
  { title: 'Create your group', detail: 'Pick a name and avatar. New groups start private, with you already on the player roster.' },
  { title: 'Add your players', detail: 'Open Group settings > View players to add friends by player ID or add guests.' },
  { title: 'Play and save scores', detail: 'Choose a game in Game Types. Saved scores update History and the leaderboard.' },
];

export function GroupCreationGuide() {
  return (
    <View style={guide.card}>
      <Text accessibilityRole="header" style={guide.heading}>How it works</Text>
      {steps.map((step, index) => (
        <View key={step.title} style={guide.step}>
          <View style={guide.number}>
            <Text accessibilityLabel={`Step ${index + 1}`} style={guide.numberText}>{index + 1}</Text>
          </View>
          <View style={guide.copy}>
            <Text style={guide.label}>{step.title}</Text>
            <Text style={guide.detail}>{step.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const guide = StyleSheet.create({
  card: { padding: 16, gap: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.rowTint },
  heading: { color: colors.foreground, fontSize: 18, fontWeight: '800' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  number: { minWidth: 24, minHeight: 24, padding: 3, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, backgroundColor: colors.selected },
  numberText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  label: { color: colors.foreground, fontSize: 13, fontWeight: '700' },
  detail: { color: colors.secondary, fontSize: 12, lineHeight: 17 },
});
