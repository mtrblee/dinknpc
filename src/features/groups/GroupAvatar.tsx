import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getGroupAvatar, GROUP_AVATARS } from '../../domain/groupAvatars';
import type { GroupAvatarId } from '../../domain/groupAvatars';
import { colors, styles } from './ui';

export function GroupAvatar({ avatar, size = 48 }: { avatar: GroupAvatarId; size?: number }) {
  const choice = getGroupAvatar(avatar);
  return (
    <View accessible accessibilityLabel={`${choice.label} group avatar`}
      style={[avatars.badge, { width: size, height: size, borderRadius: size / 3 }]}>
      <Text accessible={false} allowFontScaling={false} style={{ fontSize: size * 0.6 }}>{choice.emoji}</Text>
    </View>
  );
}

export function GroupAvatarPicker({ value, onChange, disabled = false }: {
  value: GroupAvatarId; onChange: (avatar: GroupAvatarId) => void; disabled?: boolean;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.label}>Group avatar</Text>
      <View style={avatars.grid}>
        {GROUP_AVATARS.map((avatar) => (
          <Pressable key={avatar.id} accessibilityRole="radio" accessibilityLabel={`${avatar.label} group avatar`}
            accessibilityState={{ checked: value === avatar.id, disabled }} disabled={disabled}
            onPress={() => { if (!disabled && value !== avatar.id) onChange(avatar.id); }}
            style={({ pressed }) => [avatars.choice, value === avatar.id && avatars.selected, (pressed || disabled) && styles.dimmed]}>
            <Text accessible={false} allowFontScaling={false} style={avatars.emoji}>{avatar.emoji}</Text>
            {value === avatar.id && <Text accessible={false} allowFontScaling={false} style={avatars.check}>{'\u2713'}</Text>}
          </Pressable>
        ))}
      </View>
      <Text style={styles.secondary}>Selected: {getGroupAvatar(value).label}</Text>
    </View>
  );
}

const avatars = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.selected, flexShrink: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, borderColor: colors.softBorder,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: colors.primary, backgroundColor: colors.selected },
  emoji: { fontSize: 26 },
  check: { position: 'absolute', top: 0, right: 3, fontSize: 12, fontWeight: '800', color: colors.primary },
});
