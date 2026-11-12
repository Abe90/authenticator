import { decodeBase32 } from './base32.mjs';

// The same key bytes and type give the same codes, so the vault keeps only one such account.
export function accountKey({ secret, type }) {
  return `${type}:${decodeBase32(secret).toHex()}`;
}

export function findDuplicate(accounts, record) {
  const key = accountKey(record);
  return accounts.find((account) => accountKey(account) === key) ?? null;
}

// Accounts that share a key because two computers added it between syncs: groups of two or more, oldest first.
export function duplicateGroups(accounts) {
  const groups = Map.groupBy(accounts, accountKey);
  return [...groups.values()].filter((group) => group.length > 1)
    .map((group) => group.toSorted((a, b) => a.added - b.added));
}

export class DuplicateAccountError extends Error {
  constructor(existing) {
    super(`This code is already in your list as “${existing}”.`);
    this.name = 'DuplicateAccountError';
    this.existing = existing;
  }
}

// For each export entry: null, or why it cannot be added (already stored, or listed twice in the export).
export function duplicateReasons(entries, accounts) {
  const stored = new Set(accounts.map(accountKey));
  const seen = new Set();
  return entries.map((entry) => {
    if (!entry.record) return null;
    const key = accountKey(entry.record);
    if (stored.has(key)) return 'Already in your list.';
    if (seen.has(key)) return 'Listed twice in this export.';
    seen.add(key);
    return null;
  });
}

// For each record read from another vault: { skip, note }. A key already stored is skipped, unless it is an HOTP
// account with a higher counter, which the copy raises (vault.mjs copyRecords): its codes up to there may be used.
export function copyChoices(records, accounts) {
  const stored = new Map(accounts.map((account) => [accountKey(account), account]));
  const seen = new Set();
  return records.map((record) => {
    const key = accountKey(record);
    if (seen.has(key)) return { skip: 'Listed twice in that vault.', note: null };
    seen.add(key);
    const existing = stored.get(key);
    if (!existing) return { skip: null, note: null };
    if (record.type === 'hotp' && BigInt(record.counter) > BigInt(existing.counter)) {
      return { skip: null, note: `In your list as “${existing.name}” with a lower counter, which the copy raises.` };
    }
    return { skip: 'Already in your list.', note: null };
  });
}
