import { VaultError, openVault, readVaults, syncWriteError, withVaultLock } from './vault.mjs';
import {
  KEPT_COPY_KEY, VAULT_COPY_AT_KEY, VAULT_COPY_KEY, accountItem, parseItem, vaultItem,
} from './storage-keys.mjs';

// The headers and accounts of every vault in a set of items, as stored.
const vaultItems = (items) => Object.fromEntries(Object.entries(items).filter(([name]) => parseItem(name)));
const sorted = (items) => JSON.stringify(Object.entries(items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isTime = (time) => time === null || (Number.isSafeInteger(time) && time > 0);
// Every key of one vault, its header and its accounts.
const vaultKeys = (items, vaultId) => Object.keys(items).filter((name) => parseItem(name)?.vaultId === vaultId);
const headerIds = (items) => Object.keys(items).map(parseItem).filter((item) => item?.kind === 'vault')
  .map((item) => item.vaultId);

// The main vault of the copy is lost when its header has left sync storage and no older vault took its place. The
// extension removes only the other vaults, after a merge or on request, never the main one: something outside it did,
// such as an uninstall on another computer, which Firefox Sync then carries to every computer.
function lost(items, copy) {
  const [kept] = readVaults(copy);
  if (!kept || vaultItem(kept.id) in items) return false;
  const [main] = readVaults({ ...items, [vaultItem(kept.id)]: copy[vaultItem(kept.id)] });
  return main.id === kept.id;
}

// The kept vaults that sync storage still lacks, oldest first.
const restorable = (items, kept) => readVaults(kept.items).filter(({ id }) => !(vaultItem(id) in items));

function dropKept(kept, vaultId) {
  for (const name of vaultKeys(kept.items, vaultId)) delete kept.items[name];
  delete kept.at[vaultId];
}

// Each computer keeps in storage.local a copy of the vaults in storage.sync, encrypted as they are. When the main
// vault is lost from sync, the vaults of the copy that sync lacks are kept aside, and nothing goes back by itself: an
// old copy would bring back a password changed since, or codes removed since. The user restores a kept vault, or
// deletes it, after opening it with its password or recovery key. It shares withVaultLock with VaultSession, so a
// copy never sees half of a write.
export class VaultCopy {
  #sync;
  #local;
  #exclusive;
  #now;

  constructor(sync, local, exclusive = withVaultLock, now = () => Date.now()) {
    this.#sync = sync;
    this.#local = local;
    this.#exclusive = exclusive;
    this.#now = now;
  }

  async #read() {
    const [items, stored] = await Promise.all([
      this.#sync.get(null), this.#local.get([VAULT_COPY_KEY, VAULT_COPY_AT_KEY, KEPT_COPY_KEY]),
    ]);
    const copy = isObject(stored[VAULT_COPY_KEY]) ? vaultItems(stored[VAULT_COPY_KEY]) : {};
    const copyAt = isTime(stored[VAULT_COPY_AT_KEY]) ? stored[VAULT_COPY_AT_KEY] : null;
    const saved = stored[KEPT_COPY_KEY];
    const kept = { items: isObject(saved?.items) ? vaultItems(saved.items) : {}, at: {} };
    for (const id of headerIds(kept.items)) kept.at[id] = isTime(saved.at?.[id]) ? saved.at[id] : null;
    return { items, copy, copyAt, kept };
  }

  async #writeKept(kept) {
    if (Object.keys(kept.items).length) await this.#local.set({ [KEPT_COPY_KEY]: kept });
    else await this.#local.remove(KEPT_COPY_KEY);
  }

  // Keeps aside the vaults of a lost copy, drops the kept vaults that sync storage holds again, and brings the copy
  // in line with sync storage. It never writes to sync storage. Resolves to whether it kept a vault.
  refresh() {
    return this.#exclusive(async () => {
      const { items, copy, copyAt, kept } = await this.#read();
      let changed = false;
      const keeping = lost(items, copy);
      if (keeping) {
        for (const { id } of readVaults(copy)) {
          if (vaultItem(id) in items) continue;
          dropKept(kept, id);
          for (const name of vaultKeys(copy, id)) kept.items[name] = copy[name];
          kept.at[id] = copyAt;
          changed = true;
        }
      }
      for (const id of Object.keys(kept.at)) {
        if (!(vaultItem(id) in items)) continue;
        dropKept(kept, id);
        changed = true;
      }
      if (changed) await this.#writeKept(kept);
      const current = vaultItems(items);
      if (sorted(current) !== sorted(copy)) {
        await this.#local.set({ [VAULT_COPY_KEY]: current, [VAULT_COPY_AT_KEY]: this.#now() });
      }
      return keeping;
    });
  }

  // The kept vaults that could be restored, oldest first: when their copy was made (at, or null), their codes.
  async kept() {
    const { items, kept } = await this.#read();
    return restorable(items, kept)
      .map(({ id, header, accounts }) => ({ id, created: header.created, codes: accounts.size, at: kept.at[id] }));
  }

  // Reads the first kept vault that the password or recovery key (wrap) opens, without writing anything: its codes in
  // list order, each with whether sync storage has it, and whether restoring it would put another vault after it.
  async open(wrap, secret) {
    const { items, kept } = await this.#read();
    const vaults = restorable(items, kept);
    if (!vaults.length) throw new VaultError('not-found', 'No kept vault');
    const [main] = readVaults(items);
    for (const vault of vaults) {
      let opened;
      try { opened = await openVault(vault, wrap, secret); } catch (error) {
        if (error?.reason === 'wrong-secret') continue;
        throw error;
      }
      return {
        vaultId: vault.id,
        at: kept.at[vault.id],
        damaged: opened.damaged,
        replaces: Boolean(main) && readVaults({ ...items, [vaultItem(vault.id)]: vault.header })[0].id === vault.id,
        accounts: opened.accounts.map(({ id, name }) => ({ id, name, inSync: accountItem(vault.id, id) in items })),
      };
    }
    throw new VaultError('wrong-secret', `Incorrect ${wrap}`);
  }

  // Puts a kept vault back in sync storage, in one set(): its header and the chosen accounts, as stored. An account
  // that sync storage already has is newer and stays. The vault is then no longer kept. Resolves to the number of
  // accounts written.
  restore(vaultId, accountIds) {
    return this.#exclusive(async () => {
      const { items, kept } = await this.#read();
      const header = kept.items[vaultItem(vaultId)];
      if (!header) throw new VaultError('not-found', 'Vault not kept');
      if (vaultItem(vaultId) in items) throw new VaultError('exists', 'Vault back in sync storage');
      const set = { [vaultItem(vaultId)]: header };
      let written = 0;
      for (const id of new Set(accountIds)) {
        const name = accountItem(vaultId, id);
        if (!(name in kept.items) || name in items) continue;
        set[name] = kept.items[name];
        written++;
      }
      try { await this.#sync.set(set); } catch (error) { throw syncWriteError(error); }
      dropKept(kept, vaultId);
      await this.#writeKept(kept).catch(() => {});
      return written;
    });
  }

  // Deletes a kept vault from this computer.
  discard(vaultId) {
    return this.#exclusive(async () => {
      const { kept } = await this.#read();
      dropKept(kept, vaultId);
      await this.#writeKept(kept);
    });
  }
}
