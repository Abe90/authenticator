import { t } from '../../shared/i18n.mjs';
import { failureText } from './messages.mjs';

// Shared by the Add code form, the Scanned code page and the Edit code page.
export const NAME_REQUIRED = t('nameRequired');

export const changeHint = (type) => (type === 'hotp' ? t('hintHotp') : t('hintTotp'));

export const saveFailure = (failure) => failureText(failure, t('saveFailed'));

// The accounts to warn about duplicates; an unreadable vault skips the warning, as saving refuses them anyway.
export async function storedAccounts(vault) {
  try { return await vault.read(); } catch { return []; }
}
