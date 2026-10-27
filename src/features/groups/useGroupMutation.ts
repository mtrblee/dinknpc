import { useEffect, useRef, useState } from 'react';
import { dataErrorMessage } from '../../services/groupsApi';
import type { GroupsApi } from '../../services/groupsApi';
import type { GroupCommand, SavedGroup } from '../../types/api';

export function useGroupMutation(group: SavedGroup, api: GroupsApi, onUpdate: (group: SavedGroup) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  async function run(command: GroupCommand, onSaved?: () => void) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.change(group, command);
      onUpdate(updated);
      if (live.current) onSaved?.();
      return live.current;
    } catch (caught) {
      if (live.current) setError(dataErrorMessage(caught));
      else console.warn('A group save failed after leaving its screen. Refresh the group to check its saved state.');
      return false;
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return { busy, error, run };
}
