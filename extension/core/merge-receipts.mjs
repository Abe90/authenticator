import { MERGE_RECEIPTS_KEY, isId } from './storage-keys.mjs';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();

// SHA-256 of a vault's snapshot (vault.mjs snapshotOf), in hex: the receipt keeps it, not the encrypted items.
export async function snapshotDigest(snapshot) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(snapshot))).toHex();
}

// This computer's receipts of copies from other vaults, in storage.local and never synced: another computer, or a
// changed source, offers the copy again. Older versions do not read them.
export class MergeReceipts {
  #local;

  constructor(local) {
    this.#local = local;
  }

  async #all() {
    const { [MERGE_RECEIPTS_KEY]: stored } = await this.#local.get(MERGE_RECEIPTS_KEY);
    return isObject(stored) ? stored : {};
  }

  // After a copy: what was examined, and what came of it.
  async save(source, { target, snapshot, added, skipped, unreadable }) {
    const all = await this.#all();
    all[source] = { target, digest: await snapshotDigest(snapshot), added, skipped, unreadable, at: Date.now() };
    await this.#local.set({ [MERGE_RECEIPTS_KEY]: all });
  }

  // The receipt of a source still as it was copied, into target, which still has the accounts added; or null.
  async current({ id, snapshot }, target, accountIds) {
    const receipt = (await this.#all())[id];
    if (!isObject(receipt) || receipt.target !== target || !Array.isArray(receipt.added)) return null;
    if (receipt.digest !== await snapshotDigest(snapshot)) return null;
    const have = new Set(accountIds);
    return receipt.added.every((added) => isId(added) && have.has(added)) ? receipt : null;
  }
}
