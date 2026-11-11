import { DuplicateAccountError } from '../../core/duplicates.mjs';
import { MIN_PASSWORD_LENGTH } from '../../core/limits.mjs';

// Texts that several pages show.
export const WRONG_PASSWORD = 'Incorrect password. Please try again.';
export const PASSWORD_MISMATCH = 'The passwords do not match.';
export const PASSWORD_TOO_SHORT = `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;

// "1 code", "2 codes".
export const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

// What a failed write says: a duplicate or a full sync storage is named, anything else gets fallback.
export function failureText(error, fallback) {
  if (error instanceof DuplicateAccountError) return error.message;
  return error?.reason === 'storage-full' ? 'Firefox’s sync storage is full.' : fallback;
}
