import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createGroup, ValidationError } from './src/domain/groups';
import { GroupScreen } from './src/features/groups/GroupScreen';
import { Action, colors, ErrorMessage, Field, styles } from './src/features/groups/ui';
import type { Group } from './src/types/groups';

export default function App() {
  const [groups, setGroups] = useState<readonly Group[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = groups.find((group) => group.id === selectedId);

  function submitGroup() {
    try {
      const group = createGroup(groups, name);
      setGroups([...groups, group]);
      setSelectedId(group.id);
      setName('');
      setError(null);
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      setError(caught.message);
    }
  }

  function updateGroup(updated: Group) {
    setGroups((current) => current.map((group) => group.id === updated.id ? updated : group));
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={layout.container}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={layout.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text accessibilityRole="header" style={styles.title}>DinkNPC</Text>
        <Text style={styles.body}>Your group's pickleball scores and standings</Text>
        <View style={styles.notice}>
          <Text style={styles.label}>Local prototype - data resets when the app restarts.</Text>
          <Text style={styles.body}>
            Simulated money only. No payments, deposits, transfers or real-money settlement.
            Groups are not shared between devices.
          </Text>
        </View>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>Groups</Text>
          {groups.length === 0 && <Text style={styles.body}>Create a group to get started.</Text>}
          {groups.map((group) => (
            <Action
              key={group.id}
              title={group.name}
              selected={group.id === selectedId}
              onPress={() => setSelectedId(group.id)}
            />
          ))}
          <Field label="New group name" value={name} onChangeText={setName} autoCapitalize="words" />
          <ErrorMessage message={error} />
          <Action title="Create group" onPress={submitGroup} />
        </View>
        {selected && <GroupScreen key={selected.id} group={selected} onUpdate={updateGroup} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const layout = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 20,
  },
});
