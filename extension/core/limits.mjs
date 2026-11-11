export const MAX_NAME_LENGTH = 100;
export const MAX_SECRET_LENGTH = 512;
export const MAX_COUNTER = 0xffffffffffffffffn;
// For a password chosen from now on; an existing vault opens with whatever password it has.
export const MIN_PASSWORD_LENGTH = 4;

export const isAccountName = (name) => typeof name === 'string' && name.trim() !== '' && name.length <= MAX_NAME_LENGTH;

// Counted as characters, not UTF-16 units: an emoji is one.
export const isNewPassword = (text) => typeof text === 'string' && [...text].length >= MIN_PASSWORD_LENGTH;

export const isCounter = (text) => typeof text === 'string' && /^\d{1,20}$/.test(text) && BigInt(text) <= MAX_COUNTER;
