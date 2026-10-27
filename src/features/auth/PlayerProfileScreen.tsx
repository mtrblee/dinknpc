import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { authErrorMessage } from '../../services/auth';
import type { AuthService } from '../../services/auth';
import { DataError, dataErrorMessage } from '../../services/groupsApi';
import { Action, ErrorMessage, Field, styles } from '../groups/ui';
import { AuthPage } from './AuthScreen';

export function PlayerProfileScreen({
  service, onSignOut, signingOut, externalError, initialName = '', onCancel, onSaved, onBusyChange, onSave,
}: {
  service: AuthService;
  onSignOut: () => void;
  signingOut: boolean;
  externalError: string | null;
  initialName?: string;
  onCancel?: () => void;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onSave?: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    try {
      if (onSave) await onSave(name);
      else await service.setDisplayName(name);
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof DataError ? dataErrorMessage(caught) : authErrorMessage(caught));
    } finally {
      submitting.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }

  return (
    <AuthPage
      title={onCancel ? 'Change your display name' : 'Choose your player name'}
      description="This is the name other players will see in groups and on leaderboards."
    >
      <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" editable={!saving && !signingOut} />
      <Text style={styles.secondary}>
        Names do not need to be unique. Your player ID identifies your account.
        {' '}{onCancel
          ? 'Changes update your name in all groups, games, leaderboards, and tournaments. Other devices see the change when they refresh.'
          : 'After saving, open Settings and use Copy player code to let a group member add you.'}
      </Text>
      <ErrorMessage message={error ?? externalError} />
      <Action title={saving ? 'Saving...' : 'Save player name'} onPress={() => void save()} disabled={saving || signingOut} />
      {onCancel
        ? <Action title="Cancel" onPress={onCancel} disabled={saving || signingOut} />
        : <Action title="Sign out" onPress={onSignOut} disabled={saving || signingOut} />}
    </AuthPage>
  );

}
