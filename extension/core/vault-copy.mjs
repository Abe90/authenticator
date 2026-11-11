import { readVaults, syncWriteError, withVaultLock } from './vault.mjs';
import { VAULT_COPY_KEY, parseItem, vaultItem } from './storage-keys.mjs';

// The headers and accounts of every vault in a set of items, as stored.
const vaultItems = (items) => Object.fromEntries(Object.entries(items).filter(([name]) => parseItem(name)));
const sorted = (items) => JSON.stringify(Object.entries(items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// The main vault of the copy is lost when its header has left sync storage and no older vault took its place. The
// extension removes only the other vaults, after a merge or on request, never the main one: something outside it did,
// such as an uninstall on another computer, which Firefox Sync then carries to every computer.
function lost(items, copy) {
  const [kept] = readVaults(copy);
  if (!kept || vaultItem(kept.id) in items) return false;
  const [main] = readVaults({ ...items, [vaultItem(kept.id)]: copy[vaultItem(kept.id)] });
  return main.id === kept.id;
}

// Each computer keeps in storage.local a copy of the vaults in storage.sync, encrypted as they are. When the main
// vault is lost from sync, the copy goes back, and Firefox Sync brings it to the other computers again: the vault
// lasts as long as one computer still has the extension. It shares withVaultLock with VaultSession, so a copy never
// sees half of a write.
export class VaultCopy {
  #sync;
  #local;
  #exclusive;

  constructor(sync, local, exclusive = withVaultLock) {
    this.#sync = sync;
    this.#local = local;
    this.#exclusive = exclusive;
  }

  async #read() {
    const [items, { [VAULT_COPY_KEY]: stored }] = await Promise.all([
      this.#sync.get(null), this.#local.get(VAULT_COPY_KEY),
    ]);
    const copy = stored && typeof stored === 'object' && !Array.isArray(stored) ? vaultItems(stored) : {};
    return { items, copy };
  }

  // Whether the main vault is lost and refresh() would write it back. It takes no lock, so a page never waits for
  // another window's write: no write removes the main vault, so none can make it look lost half-way.
  async lost() {
    const { items, copy } = await this.#read();
    return lost(items, copy);
  }

  // Writes a lost vault back, in one set() of the keys that sync storage lacks, and resolves to true. Otherwise
  // brings the copy in line with sync storage and resolves to false.
  refresh() {
    return this.#exclusive(async () => {
      const { items, copy } = await this.#read();
      if (lost(items, copy)) {
        const missing = Object.fromEntries(Object.entries(copy).filter(([name]) => !(name in items)));
        try { await this.#sync.set(missing); } catch (error) { throw syncWriteError(error); }
        return true;
      }
      const current = vaultItems(items);
      if (sorted(current) !== sorted(copy)) await this.#local.set({ [VAULT_COPY_KEY]: current });
      return false;
    });
  }

  // For a page about to read the vault: writes a lost vault back, taking the lock only then. It never rejects, and
  // resolves to whether it wrote: on a failure the page goes on with what sync storage holds.
  async repair() {
    try { return (await this.lost()) && (await this.refresh()); } catch { return false; }
  }
}
