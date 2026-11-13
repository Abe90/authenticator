import {
  createVault, decode, importVaultKey, openAccount, openCounters, parseRecoveryKey, passwordKey, recoveryKey, rewrap,
  sealAccount, sealCounters, unwrapVaultKey, validateHeader, verifyVaultKey,
} from './vault-crypto.mjs';
import { DuplicateAccountError, accountKey } from './duplicates.mjs';
import { MAX_COUNTER, isAccountName, isNewPassword, shownName } from './limits.mjs';
import { addSites, removeSites } from './sites.mjs';
import {
  CLOSED_STORAGE_KEY, HANDOFF_STORAGE_KEY, HOLDERS_STORAGE_KEY, HOTP_COUNTERS_KEY, LAST_INPUT_STORAGE_KEY,
  TRUSTED_HEADER_KEY,
  UNLOCK_STORAGE_KEY, accountItem, isId, parseItem, randomId, vaultItem,
} from './storage-keys.mjs';
import { HANDOFF_MS, withUnlockLock } from './auto-lock.mjs';

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPosition = (a, b) => a.position - b.position || compareIds(a.id, b.id);
// Accounts as pages see them: in list order, without the position, with their names cleaned (limits.mjs).
const visible = (accounts) => accounts.toSorted(byPosition)
  .map(({ position, ...account }) => ({ ...account, name: shownName(account.name) }));
const maxCounter = (a, b) => (BigInt(a) >= BigInt(b) ? a : b);
const nextPosition = (accounts) => (accounts.length ? Math.max(...accounts.map((account) => account.position)) + 1 : 0);
// The minutes a remembered unlock lasts after the last window holding it closes: a whole number whose milliseconds
// stay exact, or null for no time limit.
const validMinutes = (minutes) => minutes === null
  || (Number.isSafeInteger(minutes) && minutes > 0 && Number.isSafeInteger(minutes * 60000));

// A failure the pages explain, told apart by its reason:
// - 'wrong-secret': the password or recovery key does not open the vault;
// - 'not-recovery-key': the text typed is not a recovery key;
// - 'not-found': the vault asked for is not in sync storage;
// - 'exists': a vault is already there;
// - 'storage-full': sync storage refused the write for its limits;
// - 'weak-password': a new password is too short (limits.mjs);
// - 'changed': another vault changed since its codes were read for a copy;
// - 'locked': the vault was locked, or another vault became the main one, since the call started.
export class VaultError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'VaultError';
    this.reason = reason;
  }
}

const weakPassword = () => new VaultError('weak-password', 'The new password is too short');

// Serialises every write to the vaults across windows and the background script.
export const withVaultLock = (operation) => navigator.locks.request('authenticator-vault', operation);

// The vaults in a storage area, oldest first: the first is the main vault on every computer. A damaged header hides
// its vault; account items whose vault has no header are left alone.
export function readVaults(items) {
  const vaults = new Map();
  for (const [name, value] of Object.entries(items)) {
    const item = parseItem(name);
    if (item?.kind !== 'vault') continue;
    try { vaults.set(item.vaultId, { id: item.vaultId, header: validateHeader(value), accounts: new Map() }); }
    catch { /* Unreadable, so not offered. */ }
  }
  for (const [name, value] of Object.entries(items)) {
    const item = parseItem(name);
    if (item?.kind === 'account') vaults.get(item.vaultId)?.accounts.set(item.accountId, value);
  }
  return [...vaults.values()].sort((a, b) => a.header.created - b.header.created || compareIds(a.id, b.id));
}

// A write that sync storage refused for its limits says so.
export function syncWriteError(error) {
  if (!/quota/i.test(String(error?.message))) return error;
  return new VaultError('storage-full', 'Sync storage is full');
}

// A vault besides the main one, which must still be there.
function otherVault(items, vaultId) {
  const vault = readVaults(items).slice(1).find((entry) => entry.id === vaultId);
  if (!vault) throw new VaultError('not-found', 'Vault not found');
  return vault;
}

// Every key of one vault, its header and its accounts.
const vaultKeys = (items, vaultId) => Object.keys(items).filter((name) => parseItem(name)?.vaultId === vaultId);
// One vault's items as stored, in a fixed order: a copy from it checks that it has not changed since its preview.
export const snapshotOf = (items, vaultId) => JSON.stringify(vaultKeys(items, vaultId).sort()
  .map((name) => [name, items[name]]));

// An account that does not decrypt or validate is skipped and counted, and never written back.
async function openAccounts(key, vault) {
  const accounts = [];
  let damaged = 0;
  for (const [id, value] of vault.accounts) {
    try { accounts.push(await openAccount(key, vault.id, id, value)); } catch { damaged++; }
  }
  return { accounts, damaged };
}

// Unwraps the vault key with its password or recovery key; Web Crypto fails to decrypt with a wrong one.
async function unwrap(vault, wrap, secret) {
  const salt = decode(vault.header.salt, 16);
  const wrapKey = wrap === 'password' ? await passwordKey(secret, salt) : await recoveryKey(secret, salt);
  try {
    return await unwrapVaultKey(vault.id, vault.header, wrap, wrapKey);
  } catch (error) {
    if (error?.name === 'OperationError') throw new VaultError('wrong-secret', `Incorrect ${wrap}`);
    throw error;
  }
}

function recoveryBytes(text) {
  try { return parseRecoveryKey(text); } catch { throw new VaultError('not-recovery-key', 'Invalid recovery key'); }
}

// For the read-only recovery (core/recovery.mjs).
export { unwrap as unwrapVault, openAccounts, visible };

// Reads the accounts of a vault, as readVaults() gives it, with its password or recovery key (wrap), without
// unlocking it: in list order, with their ids.
export async function openVault(vault, wrap, text) {
  const secret = wrap === 'recovery' ? recoveryBytes(text) : text;
  try {
    const { accounts, damaged } = await openAccounts(await unwrap(vault, wrap, secret), vault);
    return { accounts: visible(accounts), damaged };
  } finally {
    if (wrap === 'recovery') secret.fill(0);
  }
}

function addRecords(accounts, records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Select at least one account');
  const names = new Map(accounts.map((account) => [accountKey(account), account.name]));
  let position = nextPosition(accounts);
  const now = Date.now();
  for (const { name, secret, type, counter, added, sites } of records) {
    const key = accountKey({ secret, type });
    if (names.has(key)) throw new DuplicateAccountError(shownName(names.get(key)));
    names.set(key, name);
    const account = { id: randomId(), name, secret, type, counter, position: position++, added: added ?? now };
    addSites(account, sites);
    accounts.push(account);
  }
}

// Adds accounts copied from another vault, keeping their dates, their sites and the fields a later version added. A
// key already stored is not added again, except that an HOTP account whose copy has a higher counter takes that
// counter, since its codes up to there may have been used, and the copy's sites join its own. Resolves to the IDs of
// the accounts added.
function copyRecords(accounts, records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Select at least one account');
  const stored = new Map(accounts.map((account) => [accountKey(account), account]));
  const added = [];
  let position = nextPosition(accounts);
  const now = Date.now();
  // The ID and the place in the list belong to the other vault, and are left out of fields.
  for (const { id, position: place, name, secret, type, counter, added: date, ...fields } of records) {
    const key = accountKey({ secret, type });
    const existing = stored.get(key);
    if (existing) {
      if (type !== 'hotp' || BigInt(counter) <= BigInt(existing.counter)) {
        throw new DuplicateAccountError(shownName(existing.name));
      }
      existing.counter = counter;
      addSites(existing, fields.sites);
      continue;
    }
    const account = {
      ...fields, id: randomId(), name, secret, type, counter, position: position++, added: date ?? now,
    };
    accounts.push(account);
    stored.set(key, account);
    added.push(account.id);
  }
  return added;
}

// The vault in storage.sync and its remembered unlock in storage.session; Web Locks serialise writes across windows.
// With local, storage.local, it keeps the trusted header of the read-only recovery.
export class VaultSession {
  #storage;
  #session;
  #local;
  #exclusive;
  #unlockExclusive;
  #key = null;
  #vaultId = null;
  // The remembered unlock this session holds: set by restore() and remember(), and null after a password, the
  // recovery key or a new vault, whose first remember() starts a new one.
  #sessionId = null;
  #revision = 0;
  #damaged = 0;

  #assertCurrent(current) {
    if (current !== this.#revision) throw new VaultError('locked', 'Vault is locked');
  }

  constructor(storage, session, exclusive = withVaultLock, unlockExclusive = withUnlockLock, local = null) {
    this.#storage = storage;
    this.#session = session;
    this.#local = local;
    this.#exclusive = exclusive;
    this.#unlockExclusive = unlockExclusive;
  }

  // Accounts of the main vault that could not be read at the last unlock, restore, read or write.
  get damaged() { return this.#damaged; }

  get sessionId() { return this.#sessionId; }

  // The ID of the vault this session holds open, or null.
  get vaultId() { return this.#vaultId; }

  #items() {
    return this.#storage.get(null);
  }

  async #write(set, remove = []) {
    try {
      if (Object.keys(set).length) await this.#storage.set(set);
      if (remove.length) await this.#storage.remove(remove);
    } catch (error) {
      throw syncWriteError(error);
    }
  }

  // This computer's highest HOTP counters for a vault: { counters }, or { counters: null } when the stored ones do not
  // open, which an advance then refuses rather than start again from what sync storage says.
  async #counters(key, vaultId) {
    if (!this.#local) return { counters: {} };
    const { [HOTP_COUNTERS_KEY]: stored } = await this.#local.get(HOTP_COUNTERS_KEY);
    const sealed = stored?.[vaultId];
    if (sealed === undefined) return { counters: {} };
    try { return { counters: await openCounters(key, vaultId, sealed) }; } catch { return { counters: null }; }
  }

  // Keeps counters, each the highest of them and of what another window kept meanwhile.
  async #keepCounters(key, vaultId, counters) {
    if (!this.#local) return;
    const { counters: stored } = await this.#counters(key, vaultId);
    if (!stored) throw new Error('Counters unreadable');
    const merged = { ...stored };
    for (const [id, counter] of Object.entries(counters)) merged[id] = maxCounter(merged[id] ?? '0', counter);
    const { [HOTP_COUNTERS_KEY]: all } = await this.#local.get(HOTP_COUNTERS_KEY);
    await this.#local.set({ [HOTP_COUNTERS_KEY]: { ...all, [vaultId]: await sealCounters(key, vaultId, merged) } });
  }

  // Each HOTP account takes the highest counter of sync storage and of this computer, which keeps what it sees.
  async #reconcile(key, vaultId, accounts) {
    const { counters } = await this.#counters(key, vaultId);
    if (!counters) return { counters };
    const seen = {};
    for (const account of accounts) {
      if (account.type !== 'hotp') continue;
      const id = accountKey(account);
      const known = counters[id];
      if (known !== undefined && BigInt(known) > BigInt(account.counter)) account.counter = known;
      else if (known === undefined || BigInt(account.counter) > BigInt(known)) seen[id] = account.counter;
    }
    Object.assign(counters, seen);
    if (Object.keys(seen).length) await this.#keepCounters(key, vaultId, seen).catch(() => {});
    return { counters };
  }

  // The header this computer just proved with the password; a failure to keep it only leaves the previous one.
  async #trust(vaultId, header) {
    await this.#local?.set({ [TRUSTED_HEADER_KEY]: { vaultId, header } }).catch(() => {});
  }

  #take(key, vaultId, damaged, sessionId = null) {
    this.#key = key;
    this.#vaultId = vaultId;
    this.#damaged = damaged;
    this.#sessionId = sessionId;
  }

  // Any vault header, readable or not: a damaged vault must not invite a new one over it.
  async exists() {
    return Object.keys(await this.#items()).some((name) => parseItem(name)?.kind === 'vault');
  }

  // The vaults besides the main one, made on a computer before it was connected to Firefox Sync.
  async others() {
    const items = await this.#items();
    const [, ...others] = readVaults(items);
    return others.map(({ id, header, accounts }) => ({
      id, created: header.created, codes: accounts.size, snapshot: snapshotOf(items, id),
    }));
  }

  async create(password, recoveryText) {
    if (!isNewPassword(password)) throw weakPassword();
    const current = this.#revision;
    const recovery = recoveryBytes(recoveryText);
    try {
      return await this.#exclusive(async () => {
        if (await this.exists()) throw new VaultError('exists', 'A vault already exists');
        const { vaultId, header, key } = await createVault(password, recovery);
        this.#assertCurrent(current);
        await this.#write({ [vaultItem(vaultId)]: header });
        await this.#trust(vaultId, header);
        this.#assertCurrent(current);
        this.#take(key, vaultId, 0);
        return [];
      });
    } finally {
      recovery.fill(0);
    }
  }

  async #mainVault() {
    const [main] = readVaults(await this.#items());
    if (!main) throw new VaultError('not-found', 'No vault');
    return main;
  }

  async unlock(password) {
    this.lock();
    const current = this.#revision;
    const main = await this.#mainVault();
    const key = await unwrap(main, 'password', password);
    const { accounts, damaged } = await openAccounts(key, main);
    await this.#reconcile(key, main.id, accounts);
    this.#assertCurrent(current);
    await this.#trust(main.id, main.header);
    this.#assertCurrent(current);
    this.#take(key, main.id, damaged);
    return visible(accounts);
  }

  // Checks a password or recovery key against the main vault without unlocking it, for the first step of a procedure.
  async checkPassword(password) {
    await unwrap(await this.#mainVault(), 'password', password);
  }

  async checkRecoveryKey(recoveryText) {
    const recovery = recoveryBytes(recoveryText);
    try { await unwrap(await this.#mainVault(), 'recovery', recovery); } finally { recovery.fill(0); }
  }

  // Forgot password: the recovery key replaces the password, and the vault opens.
  async resetPassword(recoveryText, password) {
    if (!isNewPassword(password)) throw weakPassword();
    this.lock();
    const current = this.#revision;
    const recovery = recoveryBytes(recoveryText);
    try {
      return await this.#exclusive(async () => {
        const main = await this.#mainVault();
        const key = await unwrap(main, 'recovery', recovery);
        const salt = decode(main.header.salt, 16);
        const header = await rewrap(main.id, main.header, 'password', await passwordKey(password, salt), key);
        const { accounts, damaged } = await openAccounts(key, main);
        await this.#reconcile(key, main.id, accounts);
        this.#assertCurrent(current);
        await this.#write({ [vaultItem(main.id)]: header });
        await this.#trust(main.id, header);
        this.#assertCurrent(current);
        this.#take(key, main.id, damaged);
        return visible(accounts);
      });
    } finally {
      recovery.fill(0);
    }
  }

  // Both need the current password. The vault key stays, so other computers keep their unlock.
  changePassword(currentPassword, password) {
    if (!isNewPassword(password)) return Promise.reject(weakPassword());
    return this.#replaceWrap(currentPassword, 'password', (salt) => passwordKey(password, salt));
  }

  async replaceRecoveryKey(password, recoveryText) {
    const recovery = recoveryBytes(recoveryText);
    try {
      await this.#replaceWrap(password, 'recovery', (salt) => recoveryKey(recovery, salt));
    } finally {
      recovery.fill(0);
    }
  }

  async #replaceWrap(password, wrap, wrapKey) {
    const current = this.#revision;
    return this.#exclusive(async () => {
      const { key, vault } = await this.#load(current);
      await unwrap(vault, 'password', password);
      const header = await rewrap(vault.id, vault.header, wrap, await wrapKey(decode(vault.header.salt, 16)), key);
      this.#assertCurrent(current);
      await this.#write({ [vaultItem(vault.id)]: header });
      await this.#trust(vault.id, header);
    });
  }

  // The unlock ends minutesAfterClose minutes after the last window holding it closes, null meaning no time limit, or
  // with lockOnClose when that window closes; both are up to the popup. After a password, the recovery key or a new
  // vault it starts a new remembered unlock, with a new sessionId, handed off to the window holder that unlocked
  // (core/auto-lock.mjs). Otherwise it changes how the one this session holds ends, and fails with 'locked' once that
  // one has ended or another unlock replaced it, rather than bring it back.
  async remember(minutes = 0, lockOnClose = false, holder = null) {
    if (!this.#key) throw new VaultError('locked', 'Vault is locked');
    // 0 asks for no time limit, which only null stands for once stored.
    const minutesAfterClose = minutes === 0 ? null : minutes;
    if (minutes === null || !validMinutes(minutesAfterClose) || typeof lockOnClose !== 'boolean'
      || (lockOnClose && minutes !== 0)) {
      throw new Error('Invalid unlock duration');
    }
    const current = this.#revision;
    const vaultId = this.#vaultId;
    const held = this.#sessionId;
    const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', this.#key));
    try {
      await this.#unlockExclusive(async () => {
        this.#assertCurrent(current);
        if (held) {
          const { [UNLOCK_STORAGE_KEY]: stored } = await this.#session.get(UNLOCK_STORAGE_KEY);
          this.#assertCurrent(current);
          if (stored?.sessionId !== held) throw new VaultError('locked', 'Vault is locked');
        }
        const sessionId = held ?? randomId();
        const entry = {
          key: bytes.toBase64(), vaultId, sessionId, minutesAfterClose, ...(lockOnClose && { lockOnClose }),
        };
        const items = { [UNLOCK_STORAGE_KEY]: entry };
        if (!held) {
          // The windows, times and handoff of an earlier unlock do not carry over.
          await this.#session.remove([
            CLOSED_STORAGE_KEY, HOLDERS_STORAGE_KEY, HANDOFF_STORAGE_KEY, LAST_INPUT_STORAGE_KEY,
          ]);
          if (holder) items[HANDOFF_STORAGE_KEY] = { sessionId, to: holder, until: Date.now() + HANDOFF_MS };
        }
        await this.#session.set(items);
        if (current === this.#revision) this.#sessionId = sessionId;
      });
    } finally { bytes.fill(0); }
    return { minutesAfterClose, lockOnClose };
  }

  // A remembered unlock holds only while its vault is still the main one.
  async restore() {
    this.lock();
    const current = this.#revision;
    const { [UNLOCK_STORAGE_KEY]: saved } = await this.#session.get(UNLOCK_STORAGE_KEY);
    if (!saved) return null;
    try {
      if (!isId(saved.vaultId) || !isId(saved.sessionId) || !validMinutes(saved.minutesAfterClose)) {
        throw new Error('Invalid unlock');
      }
      const [main] = readVaults(await this.#items());
      if (main?.id !== saved.vaultId) throw new Error('Vault changed');
      const raw = decode(saved.key, 32);
      let key;
      try { key = await importVaultKey(raw); } finally { raw.fill(0); }
      await verifyVaultKey(key, main.id, main.header);
      const { accounts, damaged } = await openAccounts(key, main);
      await this.#reconcile(key, main.id, accounts);
      this.#assertCurrent(current);
      this.#take(key, main.id, damaged, saved.sessionId);
      return visible(accounts);
    } catch {
      if (current !== this.#revision) return null;
      await this.forget(saved.sessionId);
      return null;
    }
  }

  // Ends the remembered unlock with this sessionId without locking this session; an unlock that replaced it stays.
  forget(sessionId) {
    return this.#unlockExclusive(async () => {
      const { [UNLOCK_STORAGE_KEY]: stored } = await this.#session.get(UNLOCK_STORAGE_KEY);
      if (stored && stored.sessionId === sessionId) await this.#session.remove(UNLOCK_STORAGE_KEY);
    });
  }

  lock() {
    this.#revision++;
    this.#key = null;
    this.#vaultId = null;
    this.#sessionId = null;
  }

  // Reads with the key held when the call started; a lock in between wins over a stale result.
  async #load(current) {
    this.#assertCurrent(current);
    const key = this.#key;
    const vaultId = this.#vaultId;
    if (!key) throw new VaultError('locked', 'Vault is locked');
    const items = await this.#items();
    this.#assertCurrent(current);
    const [main] = readVaults(items);
    if (main?.id !== vaultId) throw new VaultError('locked', 'Vault changed');
    // A key that no longer opens the check would read an empty list and seal accounts no one could open.
    try { await verifyVaultKey(key, main.id, main.header); } catch {
      throw new VaultError('locked', 'Vault key changed');
    }
    this.#assertCurrent(current);
    const { accounts, damaged } = await openAccounts(key, main);
    const { counters } = await this.#reconcile(key, main.id, accounts);
    this.#assertCurrent(current);
    this.#damaged = damaged;
    return { key, vault: main, accounts, items, counters };
  }

  async read() {
    return visible((await this.#load(this.#revision)).accounts);
  }

  // change edits the accounts in place and may return more keys to remove. Only the accounts it changed are written,
  // copies before removals. The revision is taken at call time, so a write queued before a lock never runs with a
  // later unlock.
  async #commit(change) {
    const current = this.#revision;
    return this.#exclusive(async () => {
      const { key, vault, accounts, items } = await this.#load(current);
      const before = new Map(accounts.map((account) => [account.id, JSON.stringify(account)]));
      const extra = change(accounts, items) ?? [];
      const set = {};
      for (const account of accounts) {
        if (before.get(account.id) === JSON.stringify(account)) continue;
        set[accountItem(vault.id, account.id)] = await sealAccount(key, vault.id, account);
      }
      const kept = new Set(accounts.map((account) => account.id));
      const removed = [...before.keys()].filter((id) => !kept.has(id)).map((id) => accountItem(vault.id, id));
      this.#assertCurrent(current);
      await this.#write(set, [...removed, ...extra]);
      return visible(accounts);
    });
  }

  add(name, secret, type, counter = '0') {
    return this.addMany([{ name, secret, type, counter }]);
  }

  // All or nothing. Duplicates are checked inside the write lock, so two windows cannot add the same code.
  addMany(records) {
    return this.#commit((accounts) => { addRecords(accounts, records); });
  }

  // Edit code: the name, and the hosts of the sites removed and added on the page. They change the list as stored at
  // the write, so that the entries the page does not show and the sites added meanwhile elsewhere stay. Removals
  // come first; additions follow the rules of core/sites.mjs, and the ones beyond the limit are left out.
  edit(id, name, { removed = [], added = [] } = {}) {
    return this.#commit((accounts) => {
      const account = accounts.find((entry) => entry.id === id);
      if (!account) throw new Error('Account not found');
      if (!isAccountName(name)) throw new Error('Invalid name');
      if (!Array.isArray(removed) || !Array.isArray(added)) throw new Error('Invalid sites');
      account.name = name;
      removeSites(account, removed);
      addSites(account, added.map((host) => ({ host })));
    });
  }

  // A code went into a page from the context menu with this account: the page's host joins its sites, unless the
  // account has that site already or has reached the limit (core/sites.mjs), and then nothing is written.
  learnSite(id, host) {
    return this.#commit((accounts) => {
      const account = accounts.find((entry) => entry.id === id);
      if (!account) throw new Error('Account not found');
      addSites(account, [{ host }]);
    });
  }

  remove(id) {
    return this.#commit((accounts) => {
      const index = accounts.findIndex((entry) => entry.id === id);
      if (index === -1) throw new Error('Account not found');
      accounts.splice(index, 1);
    });
  }

  // Places id before targetId, or after it. A neighbour, unlike an index, survives changes from other windows. The
  // account takes a position between its new neighbours; only when none is left between them are all renumbered.
  move(id, targetId, after = false) {
    return this.#commit((accounts) => {
      const order = accounts.toSorted(byPosition);
      const moving = order.find((entry) => entry.id === id);
      if (!moving || !order.some((entry) => entry.id === targetId)) throw new Error('Account not found');
      if (id === targetId) throw new Error('Invalid move');
      const rest = order.filter((entry) => entry !== moving);
      const index = rest.findIndex((entry) => entry.id === targetId) + (after ? 1 : 0);
      const previous = rest[index - 1]?.position;
      const next = rest[index]?.position;
      const position = previous === undefined ? next - 1 : next === undefined ? previous + 1 : (previous + next) / 2;
      if (Number.isFinite(position) && position !== previous && position !== next) {
        moving.position = position;
        return;
      }
      rest.splice(index, 0, moving);
      rest.forEach((entry, place) => { entry.position = place; });
    });
  }

  // The next HOTP counter, from the highest of sync storage and this computer. This computer keeps it before sync
  // storage gets it and before the page shows its code: if it cannot, the advance fails and no code shows. Two
  // computers that advance the same key offline may show the same code once.
  advance(id) {
    const current = this.#revision;
    return this.#exclusive(async () => {
      const { key, vault, accounts, counters } = await this.#load(current);
      const account = accounts.find((entry) => entry.id === id && entry.type === 'hotp');
      if (!account) throw new Error('Counter account not found');
      if (!counters) throw new Error('Counters unreadable');
      const next = BigInt(account.counter) + 1n;
      if (next > MAX_COUNTER) throw new Error('Counter limit reached');
      account.counter = String(next);
      this.#assertCurrent(current);
      await this.#keepCounters(key, vault.id, { [accountKey(account)]: account.counter });
      const sealed = await sealAccount(key, vault.id, account);
      this.#assertCurrent(current);
      await this.#write({ [accountItem(vault.id, id)]: sealed });
      return visible(accounts);
    });
  }

  // Two computers added the same key between syncs: keeps this account and removes the others with its key.
  keepDuplicate(id) {
    return this.#commit((accounts) => {
      const kept = accounts.find((entry) => entry.id === id);
      if (!kept) throw new Error('Account not found');
      const key = accountKey(kept);
      // Oldest first, as the page that offers the choice lists them.
      const others = accounts.filter((entry) => entry !== kept && accountKey(entry) === key)
        .toSorted((a, b) => a.added - b.added);
      for (const other of others) {
        // The highest counter of the entries removed stays: their codes up to there may have been used.
        if (kept.type === 'hotp') kept.counter = maxCounter(kept.counter, other.counter);
        // Their sites join the kept account's own, which come first.
        addSites(kept, other.sites);
        accounts.splice(accounts.indexOf(other), 1);
      }
    });
  }

  // Reads the accounts of another vault with its password or recovery key, without unlocking it: { accounts, damaged,
  // snapshot, reload() }, with reload() reading them again with the same key.
  async openOther(vaultId, password) {
    return this.#openOther(vaultId, 'password', password);
  }

  async openOtherWithRecoveryKey(vaultId, recoveryText) {
    const recovery = recoveryBytes(recoveryText);
    try { return await this.#openOther(vaultId, 'recovery', recovery); } finally { recovery.fill(0); }
  }

  async #openOther(vaultId, wrap, secret) {
    const key = await unwrap(otherVault(await this.#items(), vaultId), wrap, secret);
    const read = async () => {
      const items = await this.#items();
      const { accounts, damaged } = await openAccounts(key, otherVault(items, vaultId));
      return { accounts: visible(accounts), damaged, snapshot: snapshotOf(items, vaultId), reload: read };
    };
    return read();
  }

  // Copies accounts read from another vault into the main one, and leaves that vault as it is. It fails with
  // 'changed' when that vault is no longer the snapshot its accounts were read from. Resolves to { records, added },
  // the accounts of the main vault and the IDs of those added.
  async copyFromOther(vaultId, records, snapshot) {
    let added = [];
    const result = await this.#commit((accounts, items) => {
      otherVault(items, vaultId);
      if (snapshotOf(items, vaultId) !== snapshot) throw new VaultError('changed', 'The other vault changed');
      added = copyRecords(accounts, records);
    });
    return { records: result, added };
  }

  // Removes another vault from every computer, unread: a separate choice from copying its codes.
  removeOther(vaultId) {
    return this.#commit((accounts, items) => {
      otherVault(items, vaultId);
      return vaultKeys(items, vaultId);
    });
  }
}
