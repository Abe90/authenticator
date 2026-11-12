import { DuplicateAccountError } from '../../core/duplicates.mjs';
import { MIN_PASSWORD_LENGTH } from '../../core/limits.mjs';
import { t } from '../../shared/i18n.mjs';

// Texts that several pages show.
export const WRONG_PASSWORD = t('wrongPassword');
export const PASSWORD_MISMATCH = t('passwordMismatch');
export const PASSWORD_TOO_SHORT = t('passwordTooShort', MIN_PASSWORD_LENGTH);

// What a failed write says: a duplicate or a full sync storage is named, anything else gets fallback.
export function failureText(error, fallback) {
  if (error instanceof DuplicateAccountError) return t('duplicateAccount', error.existing);
  return error?.reason === 'storage-full' ? t('storageFull') : fallback;
}
