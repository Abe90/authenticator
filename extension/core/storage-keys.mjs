// browser.storage.sync: a header per vault and an item per account. Every key holds its vault's ID, so two vaults
// made on different computers never share a key and both survive Firefox Sync's merge.
const ID = '[A-Za-z0-9_-]{11}';
const VAULT_ITEM = new RegExp(`^vault:(${ID})$`);
const ACCOUNT_ITEM = new RegExp(`^account:(${ID}):(${ID})$`);

export const vaultItem = (vaultId) => `vault:${vaultId}`;
export const accountItem = (vaultId, accountId) => `account:${vaultId}:${accountId}`;
export const isId = (id) => typeof id === 'string' && new RegExp(`^${ID}$`).test(id);
// 8 random bytes as 11 Base64url characters: keys count toward the 100 KB of sync storage.
export const randomId = () => (
  crypto.getRandomValues(new Uint8Array(8)).toBase64({ alphabet: 'base64url', omitPadding: true }));

// { kind: 'vault', vaultId }, { kind: 'account', vaultId, accountId }, or null for any other key.
export function parseItem(name) {
  const vault = VAULT_ITEM.exec(name);
  if (vault) return { kind: 'vault', vaultId: vault[1] };
  const account = ACCOUNT_ITEM.exec(name);
  return account ? { kind: 'account', vaultId: account[1], accountId: account[2] } : null;
}

// browser.storage.local: the version 1 vault and an old copy of the unlock duration, which start-up removes.
export const LEGACY_LOCAL_KEYS = ['encryptedVault', 'unlockMinutes'];
// This computer's copy of the vault items in storage.sync, encrypted as they are (core/vault-copy.mjs).
export const VAULT_COPY_KEY = 'vaultCopy';

// browser.storage.session: cleared when Firefox closes.
// The remembered unlock: the exported vault key, its vault's ID and how it ends.
export const UNLOCK_STORAGE_KEY = 'unlockedVault';
// When the last extension window closed, recorded by the background script: a timed unlock counts from there.
export const CLOSED_STORAGE_KEY = 'windowsClosedAt';
// IDs of the HOTP accounts that showed a code during the current unlock.
export const REVEALED_STORAGE_KEY = 'revealedHotp';
// Until when the Add code window may restore an unlock that ends when the popup closes.
export const HANDOFF_STORAGE_KEY = 'addWindowHandoff';
// Set by an unlock with a password or the recovery key: the toolbar popup then looks for another vault, a key added
// twice and damaged accounts, once.
export const AFTER_UNLOCK_KEY = 'afterUnlock';
// The procedure of several steps the popup was in, and the recovery key it made: reopening the popup goes on from
// there. Passwords are never kept.
export const PROCEDURE_KEY = 'procedure';
// The tab and window where the toolbar popup last opened, which Scan page may capture.
export const SCAN_TARGET_KEY = 'scanTarget';
