export const MAX_NAME_LENGTH = 100;
export const MAX_SECRET_LENGTH = 512;
export const MAX_COUNTER = 0xffffffffffffffffn;
// The valid sites an account can reach by adding them; an account read with more keeps them all (core/sites.mjs).
export const MAX_SITES = 10;
// For a password chosen from now on; an existing vault opens with whatever password it has.
export const MIN_PASSWORD_LENGTH = 4;

// Characters a name never needs, which can make it look like another: controls, the bidirectional controls and the
// invisible ones. cleanName() folds white space into single spaces, removes them, and trims; it is applied to every
// name typed or imported, and to every stored name shown (shownName), not in validateAccount, which would otherwise
// count older accounts with them as damaged.
const HIDDEN = /[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\u2060\uFEFF]/gu;
export const cleanName = (text) => String(text).replace(/\s+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim();
// The name of an account without one, in the language of the extension; in English outside Firefox.
export const unnamedAccount = () => globalThis.browser?.i18n?.getMessage('unnamedAccount') || 'Unnamed account';
export const shownName = (name) => cleanName(name) || unnamedAccount();

export const isAccountName = (name) => typeof name === 'string' && name.trim() !== '' && name.length <= MAX_NAME_LENGTH;

// What is wrong with a new password: 'short', or null. Its length is counted in characters, not UTF-16 units: an
// emoji is one.
export function passwordProblem(text) {
  return typeof text !== 'string' || [...text].length < MIN_PASSWORD_LENGTH ? 'short' : null;
}
export const isNewPassword = (text) => passwordProblem(text) === null;

export const isCounter = (text) => typeof text === 'string' && /^\d{1,20}$/.test(text) && BigInt(text) <= MAX_COUNTER;
