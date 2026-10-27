import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Action, colors, styles } from './ui';

export function GuestPlayerForm({ busy, onAdd }: {
  busy: boolean; onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');

  async function save() {
    if (await onAdd(name)) {
      setName('');
    }
  }

  return (
    <View style={styles.compactForm}>
      <Text accessibilityRole="header" style={styles.compactFormTitle}>Add a guest player</Text>
      <View style={styles.compactFormRow}>
        <TextInput accessibilityLabel="Guest display name" value={name} onChangeText={setName}
          placeholder="Guest name" placeholderTextColor={colors.secondary} style={styles.compactFormInput}
          editable={!busy} autoCapitalize="words" />
        <Action title="Add guest" onPress={() => void save()} disabled={busy} compact />
      </View>
      <Text style={styles.scoreNote}>No account needed. Use a unique guest name; shown with (g).</Text>
    </View>
  );
}
