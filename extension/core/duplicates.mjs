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
    super('Duplicate account');
    this.name = 'DuplicateAccountError';
    this.existing = existing;
  }
}

// For each export entry: null, or why it cannot be added: 'stored' already, or 'repeated' in the export.
export function duplicateReasons(entries, accounts) {
  const stored = new Set(accounts.map(accountKey));
  const seen = new Set();
  return entries.map((entry) => {
    if (!entry.record) return null;
    const key = accountKey(entry.record);
    if (stored.has(key)) return 'stored';
    if (seen.has(key)) return 'repeated';
    seen.add(key);
    return null;
  });
}

// For each record read from another vault: { skip, raises }. skip is null, 'stored' for a key already stored or
// 'repeated' for one listed twice in that vault. A stored HOTP account with a lower counter is not skipped: the copy
// raises its counter (vault.mjs copyRecords), since its codes up to there may be used, and raises is its name.
export function copyChoices(records, accounts) {
  const stored = new Map(accounts.map((account) => [accountKey(account), account]));
  const seen = new Set();
  return records.map((record) => {
    const key = accountKey(record);
    if (seen.has(key)) return { skip: 'repeated', raises: null };
    seen.add(key);
    const existing = stored.get(key);
    if (!existing) return { skip: null, raises: null };
    if (record.type === 'hotp' && BigInt(record.counter) > BigInt(existing.counter)) {
      return { skip: null, raises: existing.name };
    }
    return { skip: 'stored', raises: null };
  });
}
