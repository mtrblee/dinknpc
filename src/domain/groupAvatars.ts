export const GROUP_AVATARS = [
  { id: 'paddles', emoji: '\u{1F3D3}', label: 'Paddles' },
  { id: 'trophy', emoji: '\u{1F3C6}', label: 'Trophy' },
  { id: 'medal', emoji: '\u{1F947}', label: 'Gold medal' },
  { id: 'stadium', emoji: '\u{1F3DF}\uFE0F', label: 'Stadium' },
  { id: 'mountain', emoji: '\u{1F3D4}\uFE0F', label: 'Mountain' },
  { id: 'island', emoji: '\u{1F3DD}\uFE0F', label: 'Island' },
  { id: 'sunrise', emoji: '\u{1F305}', label: 'Sunrise' },
  { id: 'city', emoji: '\u{1F306}', label: 'City' },
  { id: 'castle', emoji: '\u{1F3F0}', label: 'Castle' },
  { id: 'camp', emoji: '\u{1F3D5}\uFE0F', label: 'Camping' },
  { id: 'planet', emoji: '\u{1FA90}', label: 'Planet' },
  { id: 'rainbow', emoji: '\u{1F308}', label: 'Rainbow' },
] as const;

export type GroupAvatarId = typeof GROUP_AVATARS[number]['id'];
export const DEFAULT_GROUP_AVATAR: GroupAvatarId = 'paddles';

export class GroupAvatarError extends Error {
  constructor() {
    super('Choose an avatar from the group emoji picker.');
    this.name = 'GroupAvatarError';
  }
}

export function validateGroupAvatar(value: unknown): GroupAvatarId {
  const avatar = GROUP_AVATARS.find((entry) => entry.id === value);
  if (!avatar) throw new GroupAvatarError();
  return avatar.id;
}

export function getGroupAvatar(id: GroupAvatarId) {
  const avatar = GROUP_AVATARS.find((entry) => entry.id === id);
  if (!avatar) throw new GroupAvatarError();
  return avatar;
}
