import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AVATARS, getAvatar } from '../../domain/avatars';
import type { AvatarId } from '../../domain/avatars';
import { authErrorMessage } from '../../services/auth';
import { DataError, dataErrorMessage } from '../../services/groupsApi';
import { Action, colors, ErrorMessage, PlayerAvatar, styles } from '../groups/ui';

export function AvatarPickerScreen({ initialAvatar, onSave, onSaved, onCancel, onBusyChange, signingOut }: {
  initialAvatar: AvatarId;
  onSave: (avatar: AvatarId) => Promise<void>;
  onSaved: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  signingOut: boolean;
}) {
  const [selected, setSelected] = useState(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const busy = saving || signingOut;

  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      await onSave(selected);
      onSaved();
    } catch (caught) {
      setError(caught instanceof DataError ? dataErrorMessage(caught) : authErrorMessage(caught));
    } finally {
      submitting.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={picker.content}>
      <Text accessibilityRole="header" style={styles.title}>Choose your emoji</Text>
      <Text style={styles.secondary}>Your current emoji appears in every group and completed game. No email addresses are shown in group rosters.</Text>
      <View style={picker.preview}>
        <PlayerAvatar avatar={selected} size={80} />
        <Text accessibilityLiveRegion="polite" style={styles.label}>{getAvatar(selected).label}</Text>
      </View>
      <View style={picker.grid}>
        {AVATARS.map((avatar) => (
          <Pressable key={avatar.id} accessibilityRole="button" accessibilityLabel={`${avatar.label} avatar`}
            accessibilityState={{ selected: selected === avatar.id, disabled: busy }}
            disabled={busy} onPress={() => setSelected(avatar.id)}
            style={({ pressed }) => [picker.option, selected === avatar.id && picker.selected, (pressed || busy) && styles.dimmed]}>
            <Text accessible={false} style={picker.emoji}>{avatar.emoji}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.secondary}>The smiling face is the default. Choose it again to reset your avatar.</Text>
      <ErrorMessage message={error} />
      <Action title={saving ? 'Saving avatar...' : 'Save avatar'} onPress={() => void save()} disabled={busy} />
      <Action title="Cancel" onPress={onCancel} disabled={busy} />
    </ScrollView>
  );
}

const picker = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, gap: 20 },
  preview: { alignItems: 'center', gap: 12, padding: 20, borderRadius: 20, backgroundColor: colors.selected },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  option: { width: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  selected: { borderColor: colors.primary, backgroundColor: colors.selected },
  emoji: { fontSize: 30 },
});
