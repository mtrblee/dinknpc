export const AVATARS = [
  { id: 'smile', emoji: '\u{1F642}', label: 'Smiling face' },
  { id: 'cool', emoji: '\u{1F60E}', label: 'Sunglasses' },
  { id: 'star-eyes', emoji: '\u{1F929}', label: 'Star eyes' },
  { id: 'party', emoji: '\u{1F973}', label: 'Party face' },
  { id: 'fox', emoji: '\u{1F98A}', label: 'Fox' },
  { id: 'panda', emoji: '\u{1F43C}', label: 'Panda' },
  { id: 'frog', emoji: '\u{1F438}', label: 'Frog' },
  { id: 'tiger', emoji: '\u{1F42F}', label: 'Tiger' },
  { id: 'lion', emoji: '\u{1F981}', label: 'Lion' },
  { id: 'koala', emoji: '\u{1F428}', label: 'Koala' },
  { id: 'monkey', emoji: '\u{1F435}', label: 'Monkey' },
  { id: 'dog', emoji: '\u{1F436}', label: 'Dog' },
  { id: 'cat', emoji: '\u{1F431}', label: 'Cat' },
  { id: 'penguin', emoji: '\u{1F427}', label: 'Penguin' },
  { id: 'unicorn', emoji: '\u{1F984}', label: 'Unicorn' },
  { id: 'turtle', emoji: '\u{1F422}', label: 'Turtle' },
  { id: 'octopus', emoji: '\u{1F419}', label: 'Octopus' },
  { id: 'butterfly', emoji: '\u{1F98B}', label: 'Butterfly' },
  { id: 'bee', emoji: '\u{1F41D}', label: 'Bee' },
  { id: 'cactus', emoji: '\u{1F335}', label: 'Cactus' },
  { id: 'clover', emoji: '\u{1F340}', label: 'Clover' },
  { id: 'pineapple', emoji: '\u{1F34D}', label: 'Pineapple' },
  { id: 'rocket', emoji: '\u{1F680}', label: 'Rocket' },
  { id: 'star', emoji: '\u2B50', label: 'Star' },
] as const;

export type AvatarId = typeof AVATARS[number]['id'];
export const DEFAULT_AVATAR: AvatarId = 'smile';

export class AvatarError extends Error {
  constructor() {
    super('Choose an avatar from the emoji picker.');
    this.name = 'AvatarError';
  }
}

export function isAvatar(value: unknown): value is AvatarId {
  return AVATARS.some((avatar) => avatar.id === value);
}

export function validateAvatar(value: unknown): AvatarId {
  if (!isAvatar(value)) throw new AvatarError();
  return value;
}

export function avatarFromMetadata(value: unknown): AvatarId {
  if (value === undefined || value === null) return DEFAULT_AVATAR;
  if (isAvatar(value)) return value;
  // Unsupported editable metadata must not prevent signing in to repair the profile.
  console.error('Unsupported player avatar metadata; using the default avatar. Select an avatar in Settings to repair it.');
  return DEFAULT_AVATAR;
}

export function getAvatar(id: AvatarId = DEFAULT_AVATAR) {
  const avatar = AVATARS.find((entry) => entry.id === id);
  if (!avatar) throw new AvatarError();
  return avatar;
}
