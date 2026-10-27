import { randomBytes } from 'node:crypto';
import { PLAYER_CODE_ALPHABET } from '../../src/domain/groups.ts';

export function generatePlayerCode(): string {
  // The alphabet has exactly 32 symbols, so masking a random byte is unbiased.
  return Array.from(randomBytes(6), byte => PLAYER_CODE_ALPHABET[byte & 31]).join('');
}
