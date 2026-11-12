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
// When that copy last changed.
export const VAULT_COPY_AT_KEY = 'vaultCopyAt';
// The vaults that copy held when its main vault left storage.sync, until restored or deleted: { items, at }, with at
// the time of each vault's copy, or null when unknown.
export const KEPT_COPY_KEY = 'keptVaultCopy';
// The header of the last vault this computer opened, created or changed with its password: { vaultId, header }. Only
// those operations write it, never a remembered unlock, whose key did not prove the wraps (core/recovery.mjs).
export const TRUSTED_HEADER_KEY = 'trustedHeader';
// What this computer copied from other vaults, so that the same one is not offered again after an unlock: by source
// vault ID, { target, digest, added, skipped, unreadable, at } (core/merge-receipts.mjs).
export const MERGE_RECEIPTS_KEY = 'mergeReceipts';
// The highest HOTP counter this computer saw or used for each key, by vault ID, sealed with that vault's key: a
// counter never goes back, whatever an older write in storage.sync says (core/vault.mjs).
export const HOTP_COUNTERS_KEY = 'hotpCounters';

// browser.storage.session: cleared when Firefox closes.
// The remembered unlock: the exported vault key, its vault's ID and how it ends.
export const UNLOCK_STORAGE_KEY = 'unlockedVault';
// When the last window holding the unlock closed, recorded by the background script: a timed unlock counts from there.
export const CLOSED_STORAGE_KEY = 'windowsClosedAt';
// The windows and scans that hold the unlock, kept by the background script (core/auto-lock.mjs).
export const HOLDERS_STORAGE_KEY = 'unlockHolders';
// When the user last typed, clicked, scrolled or moved the pointer in a window or scan holding the unlock.
export const LAST_INPUT_STORAGE_KEY = 'lastInputAt';
// IDs of the HOTP accounts that showed a code during the current unlock.
export const REVEALED_STORAGE_KEY = 'revealedHotp';
// The window that may take over the unlock next, and until when: the Add code window a popup opens, the window that
// shows a scanned code, or the window that has just unlocked.
export const HANDOFF_STORAGE_KEY = 'addWindowHandoff';
// Set by an unlock with a password or the recovery key: the toolbar popup then looks for another vault, a key added
// twice and damaged accounts, once.
export const AFTER_UNLOCK_KEY = 'afterUnlock';
// The procedure of several steps the popup was in, and the recovery key it made: reopening the popup goes on from
// there. Passwords are never kept.
export const PROCEDURE_KEY = 'procedure';
// The tab and window where the toolbar popup last opened, which Scan page may capture.
export const SCAN_TARGET_KEY = 'scanTarget';
