import { failureText } from './messages.mjs';

// Shared by the Add code form, the Scanned code page and the Edit code page.
export const NAME_REQUIRED = 'Enter a code name.';

export const changeHint = (type) => (type === 'hotp'
  ? 'The code changes when you request the next one.'
  : 'The code changes every 30 seconds.');

export const saveFailure = (failure) => failureText(failure,
  'Could not save the codes. No codes were added. Please try again.');

// The accounts to warn about duplicates; an unreadable vault skips the warning, as saving refuses them anyway.
export async function storedAccounts(vault) {
  try { return await vault.read(); } catch { return []; }
}
