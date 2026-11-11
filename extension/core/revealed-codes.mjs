import { REVEALED_STORAGE_KEY } from './storage-keys.mjs';

// HOTP accounts that showed a code during this unlock; as in Google Authenticator, the others show dashes.
// The IDs live in browser.storage.session and are cleared with the remembered unlock.

export function readRevealed(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

export class RevealedCodes {
  #storage;
  #exclusive;

  // Web Locks serialise the read-modify-write between popups in different windows.
  constructor(storage, exclusive = (operation) => navigator.locks.request('authenticator-revealed', operation)) {
    this.#storage = storage;
    this.#exclusive = exclusive;
  }

  async load() {
    return readRevealed((await this.#storage.get(REVEALED_STORAGE_KEY))[REVEALED_STORAGE_KEY]);
  }

  add(id) {
    return this.#exclusive(async () => {
      const ids = await this.load();
      if (!ids.includes(id)) await this.#storage.set({ [REVEALED_STORAGE_KEY]: [...ids, id] });
    });
  }

  // Tidiness only: account IDs are never reused.
  delete(id) {
    return this.#exclusive(async () => {
      const ids = await this.load();
      if (ids.includes(id)) await this.#storage.set({ [REVEALED_STORAGE_KEY]: ids.filter((entry) => entry !== id) });
    });
  }

  clear() {
    return this.#storage.remove(REVEALED_STORAGE_KEY);
  }
}
