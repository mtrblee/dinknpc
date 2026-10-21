import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import type { Group, Team } from '../../types/groups';

export const colors = {
  background: '#F4F8F5',
  surface: '#FFFFFF',
  foreground: '#123524',
  secondary: '#42594C',
  primary: '#246B45',
  border: '#B8C8BD',
  selected: '#DDEEE2',
  warning: '#FFF1C7',
  error: '#A32424',
};

export function Action({
  title, onPress, disabled = false, selected = false, destructive = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text style={[styles.buttonText, destructive && styles.error]}>{title}</Text>
    </Pressable>
  );
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

export function teamNames(group: Group, team: Team): string {
  return team.map((id) => {
    const player = group.players.find((entry) => entry.id === id);
    if (!player) throw new Error(`Game references missing player ${id}.`);
    return player.name;
  }).join(' + ');
}

export const styles = StyleSheet.create({
  stack: { gap: 8 },
  section: { gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
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
