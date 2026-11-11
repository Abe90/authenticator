import {
  createVault, decode, importVaultKey, openAccount, parseRecoveryKey, passwordKey, recoveryKey, rewrap, sealAccount,
  unwrapVaultKey, validateHeader, verifyVaultKey,
} from './vault-crypto.mjs';
import { DuplicateAccountError, accountKey } from './duplicates.mjs';
import { MAX_COUNTER, isAccountName } from './limits.mjs';
import { UNLOCK_STORAGE_KEY, accountItem, isId, parseItem, randomId, vaultItem } from './storage-keys.mjs';

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPosition = (a, b) => a.position - b.position || compareIds(a.id, b.id);
// Accounts as pages see them: in list order, without the position.
const visible = (accounts) => accounts.toSorted(byPosition).map(({ position, ...account }) => account);
const nextPosition = (accounts) => (accounts.length ? Math.max(...accounts.map((account) => account.position)) + 1 : 0);
// The minutes a remembered unlock lasts after the last extension window closes: a whole number whose milliseconds
// stay exact, or null for no time limit.
const validMinutes = (minutes) => minutes === null
  || (Number.isSafeInteger(minutes) && minutes > 0 && Number.isSafeInteger(minutes * 60000));

// A failure the pages explain, told apart by its reason:
// - 'wrong-secret': the password or recovery key does not open the vault;
// - 'not-recovery-key': the text typed is not a recovery key;
// - 'not-found': the vault asked for is not in sync storage;
// - 'exists': a vault is already there;
// - 'storage-full': sync storage refused the write for its limits;
// - 'locked': the vault was locked, or another vault became the main one, since the call started.
export class VaultError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'VaultError';
    this.reason = reason;
  }
}

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

function addRecords(accounts, records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Select at least one account');
  const names = new Map(accounts.map((account) => [accountKey(account), account.name]));
  let position = nextPosition(accounts);
  const now = Date.now();
  for (const { name, secret, type, counter, added } of records) {
    const key = accountKey({ secret, type });
    if (names.has(key)) throw new DuplicateAccountError(names.get(key));
    names.set(key, name);
    accounts.push({ id: randomId(), name, secret, type, counter, position: position++, added: added ?? now });
  }
}

// The vault in storage.sync and its remembered unlock in storage.session; Web Locks serialise writes across windows.
export class VaultSession {
  #storage;
  #session;
  #exclusive;
  #key = null;
  #vaultId = null;
  #revision = 0;
  #damaged = 0;

  #assertCurrent(current) {
    if (current !== this.#revision) throw new VaultError('locked', 'Vault is locked');
  }

  constructor(storage, session, exclusive = withVaultLock) {
    this.#storage = storage;
    this.#session = session;
    this.#exclusive = exclusive;
  }

  // Accounts of the main vault that could not be read at the last unlock, restore, read or write.
  get damaged() { return this.#damaged; }

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

  #take(key, vaultId, damaged) {
    this.#key = key;
    this.#vaultId = vaultId;
    this.#damaged = damaged;
  }

  // Any vault header, readable or not: a damaged vault must not invite a new one over it.
  async exists() {
    return Object.keys(await this.#items()).some((name) => parseItem(name)?.kind === 'vault');
  }

  // The vaults besides the main one, made on a computer before it was connected to Firefox Sync.
  async others() {
    const [, ...others] = readVaults(await this.#items());
    return others.map(({ id, header, accounts }) => ({ id, created: header.created, codes: accounts.size }));
  }

  async create(password, recoveryText) {
    const current = this.#revision;
    const recovery = recoveryBytes(recoveryText);
    try {
      return await this.#exclusive(async () => {
        if (await this.exists()) throw new VaultError('exists', 'A vault already exists');
        const { vaultId, header, key } = await createVault(password, recovery);
        this.#assertCurrent(current);
        await this.#write({ [vaultItem(vaultId)]: header });
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
        this.#assertCurrent(current);
        await this.#write({ [vaultItem(main.id)]: header });
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
    });
  }

  // The unlock ends minutesAfterClose minutes after the last extension window closes, null meaning no time limit, or
  // with lockOnClose when that window closes; both are up to the popup.
  async remember(minutes = 0, lockOnClose = false) {
    if (!this.#key) throw new VaultError('locked', 'Vault is locked');
    // 0 asks for no time limit, which only null stands for once stored.
    const minutesAfterClose = minutes === 0 ? null : minutes;
    if (minutes === null || !validMinutes(minutesAfterClose) || typeof lockOnClose !== 'boolean'
      || (lockOnClose && minutes !== 0)) {
      throw new Error('Invalid unlock duration');
    }
    const current = this.#revision;
    const vaultId = this.#vaultId;
    const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', this.#key));
    try {
      this.#assertCurrent(current);
      const entry = { key: bytes.toBase64(), vaultId, minutesAfterClose, ...(lockOnClose && { lockOnClose }) };
      await this.#session.set({ [UNLOCK_STORAGE_KEY]: entry });
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
      if (!isId(saved.vaultId) || !validMinutes(saved.minutesAfterClose)) throw new Error('Invalid unlock');
      const [main] = readVaults(await this.#items());
      if (main?.id !== saved.vaultId) throw new Error('Vault changed');
      const raw = decode(saved.key, 32);
      let key;
      try { key = await importVaultKey(raw); } finally { raw.fill(0); }
      await verifyVaultKey(key, main.id, main.header);
      const { accounts, damaged } = await openAccounts(key, main);
      this.#assertCurrent(current);
      this.#take(key, main.id, damaged);
      return visible(accounts);
    } catch {
      if (current !== this.#revision) return null;
      await this.forget();
      return null;
    }
  }

  // Ends the remembered unlock without locking this session.
  forget() {
    return this.#session.remove(UNLOCK_STORAGE_KEY);
  }

  lock() {
    this.#revision++;
    this.#key = null;
    this.#vaultId = null;
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
    const { accounts, damaged } = await openAccounts(key, main);
    this.#assertCurrent(current);
    this.#damaged = damaged;
    return { key, vault: main, accounts, items };
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

  rename(id, name) {
    return this.#commit((accounts) => {
      const account = accounts.find((entry) => entry.id === id);
      if (!account) throw new Error('Account not found');
      if (!isAccountName(name)) throw new Error('Invalid name');
      account.name = name;
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

  advance(id) {
    return this.#commit((accounts) => {
      const account = accounts.find((entry) => entry.id === id && entry.type === 'hotp');
      if (!account) throw new Error('Counter account not found');
      const next = BigInt(account.counter) + 1n;
      if (next > MAX_COUNTER) throw new Error('Counter limit reached');
      account.counter = String(next);
    });
  }

  // Two computers added the same key between syncs: keeps this account and removes the others with its key.
  keepDuplicate(id) {
    return this.#commit((accounts) => {
      const kept = accounts.find((entry) => entry.id === id);
      if (!kept) throw new Error('Account not found');
      const key = accountKey(kept);
      for (let index = accounts.length - 1; index >= 0; index--) {
        if (accounts[index] !== kept && accountKey(accounts[index]) === key) accounts.splice(index, 1);
      }
    });
  }

  // Reads the accounts of another vault with its password or recovery key, without unlocking it.
  async openOther(vaultId, password) {
    return this.#openOther(vaultId, 'password', password);
  }

  async openOtherWithRecoveryKey(vaultId, recoveryText) {
    const recovery = recoveryBytes(recoveryText);
    try { return await this.#openOther(vaultId, 'recovery', recovery); } finally { recovery.fill(0); }
  }

  async #openOther(vaultId, wrap, secret) {
    const vault = otherVault(await this.#items(), vaultId);
    const key = await unwrap(vault, wrap, secret);
    return visible((await openAccounts(key, vault)).accounts);
  }

  // Adds accounts read from another vault, keeping their dates, then removes that vault from every computer.
  mergeOther(vaultId, records) {
    return this.#commit((accounts, items) => {
      otherVault(items, vaultId);
      addRecords(accounts, records);
      return vaultKeys(items, vaultId);
    });
  }

  removeOther(vaultId) {
    return this.#commit((accounts, items) => {
      otherVault(items, vaultId);
      return vaultKeys(items, vaultId);
    });
  }
}
