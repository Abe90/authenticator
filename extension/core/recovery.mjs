import { FORMAT } from './vault-crypto.mjs';
import { openAccounts, readVaults, unwrapVault, visible } from './vault.mjs';
import {
  KEPT_COPY_KEY, TRUSTED_HEADER_KEY, VAULT_COPY_KEY, isId, parseItem, vaultItem,
} from './storage-keys.mjs';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The account items of one vault in a set of items, by account ID.
function accountsOf(items, vaultId) {
  const accounts = new Map();
  for (const [name, value] of Object.entries(isObject(items) ? items : {})) {
    const item = parseItem(name);
    if (item?.kind === 'account' && item.vaultId === vaultId) accounts.set(item.accountId, value);
  }
  return accounts;
}

function readTrusted(stored) {
  return isObject(stored) && isId(stored.vaultId) && isObject(stored.header) ? stored : null;
}

// Why the vault a password opens is not the one an unlock reads, for the password page:
// - 'changed': the main vault, whose header in sync storage is no longer the one trusted here;
// - 'missing': its header has left sync storage;
// - 'unreadable': its header in sync storage does not validate, as one saved by a newer version (newer);
// - 'other': it is in sync storage, but another vault comes first.
function reasonFor(items, main, vaultId) {
  if (!(vaultItem(vaultId) in items)) return 'missing';
  if (main?.id === vaultId) return 'changed';
  return readVaults({ [vaultItem(vaultId)]: items[vaultItem(vaultId)] }).length ? 'other' : 'unreadable';
}

// Read-only recovery. After a password that does not unlock the main vault, find() tries it, at a submit only, on the
// header trusted here when it differs from the main vault's, then on the other vaults in sync storage: one key
// derivation each. read() reads the accounts with the key found. Neither writes anything, in sync storage or here, and
// the key lives only in the page: an old trusted header opens the accounts it opened, but sync storage keeps its
// header, so a password changed since does not work again there.
export class Recovery {
  #sync;
  #local;

  constructor(sync, local) {
    this.#sync = sync;
    this.#local = local;
  }

  // Whether sync storage holds a vault this version cannot read, saved by a newer one.
  async newerVault() {
    const items = await this.#sync.get(null);
    return Object.entries(items).some(([name, value]) => parseItem(name)?.kind === 'vault' && value?.version > FORMAT);
  }

  // The first vault the password opens besides an unlock's, or null: { vaultId, key, trusted, reason, newer,
  // created, codes }.
  async find(password) {
    const [items, stored] = await Promise.all([this.#sync.get(null), this.#local.get(TRUSTED_HEADER_KEY)]);
    const vaults = readVaults(items);
    const [main] = vaults;
    const trusted = readTrusted(stored[TRUSTED_HEADER_KEY]);
    const candidates = [];
    if (trusted && !(main?.id === trusted.vaultId && same(main.header, trusted.header))) {
      candidates.push({ id: trusted.vaultId, header: trusted.header, trusted: true });
    }
    for (const vault of vaults.slice(1)) {
      if (vault.id !== trusted?.vaultId) candidates.push({ id: vault.id, header: vault.header, trusted: false });
    }
    for (const candidate of candidates) {
      let key;
      try { key = await unwrapVault(candidate, 'password', password); } catch { continue; }
      const header = items[vaultItem(candidate.id)];
      return {
        vaultId: candidate.id,
        key,
        trusted: candidate.trusted,
        reason: reasonFor(items, main, candidate.id),
        newer: header?.version > FORMAT,
        created: candidate.header.created,
        codes: accountsOf(items, candidate.id).size,
      };
    }
    return null;
  }

  // The accounts of the vault found, in list order: those in sync storage, and apart those only in this computer's
  // copy, which may be old. Accounts that do not open are counted, as saved by a newer version when its header is.
  async read({ vaultId, key }) {
    const [items, stored] = await Promise.all([
      this.#sync.get(null), this.#local.get([VAULT_COPY_KEY, KEPT_COPY_KEY]),
    ]);
    const current = accountsOf(items, vaultId);
    const copied = new Map([
      ...accountsOf(stored[VAULT_COPY_KEY], vaultId), ...accountsOf(stored[KEPT_COPY_KEY]?.items, vaultId),
    ].filter(([id]) => !current.has(id)));
    const fromSync = await openAccounts(key, { id: vaultId, accounts: current });
    const fromCopy = await openAccounts(key, { id: vaultId, accounts: copied });
    return {
      accounts: visible(fromSync.accounts),
      older: visible(fromCopy.accounts),
      unreadable: fromSync.damaged + fromCopy.damaged,
      newer: items[vaultItem(vaultId)]?.version > FORMAT,
    };
  }
}
