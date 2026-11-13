import { decodeBase32, encodeBase32 } from './base32.mjs';
import { MAX_SECRET_LENGTH, isAccountName, isCounter } from './limits.mjs';
import { isId, randomId } from './storage-keys.mjs';

export const FORMAT = 2;
export const ITERATIONS = 600000;
const KDF = 'PBKDF2-SHA256';
const RECOVERY_BYTES = 20;
// A sealed text is an IV, the ciphertext and a tag: a wrap seals the 32-byte vault key, the check seals nothing.
const IV = 12;
const TAG = 16;
const WRAPPED = IV + 32 + TAG;
const CHECK = IV + TAG;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function decode(text, length) {
  if (typeof text !== 'string' || text.length > 8_000_000) throw new Error('Invalid vault');
  const bytes = Uint8Array.fromBase64(text);
  if (length !== undefined && bytes.length !== length) throw new Error('Invalid vault');
  return bytes;
}

// 160 random bits as 32 Base32 characters in groups of four.
export function createRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
  try { return encodeBase32(bytes).match(/.{4}/g).join('-'); } finally { bytes.fill(0); }
}

// Accepts the key with or without dashes and spaces, in either case.
export function parseRecoveryKey(text) {
  let bytes = null;
  if (typeof text === 'string' && text.length <= 100) {
    try { bytes = decodeBase32(text.replace(/-/g, '')); } catch { /* Reported below. */ }
  }
  if (bytes?.length !== RECOVERY_BYTES) {
    bytes?.fill(0);
    throw new Error('Invalid recovery key');
  }
  return bytes;
}

export function validateHeader(header) {
  if (!header || header.version !== FORMAT || header.kdf !== KDF || header.iterations !== ITERATIONS
    || !Number.isSafeInteger(header.created) || header.created <= 0) {
    throw new Error('Unsupported or damaged vault');
  }
  decode(header.salt, 16);
  decode(header.password, WRAPPED);
  decode(header.recovery, WRAPPED);
  decode(header.check, CHECK);
  return header;
}

export function validateAccount(account) {
  if (!account || !isId(account.id) || !isAccountName(account.name) || typeof account.secret !== 'string'
    || account.secret.length > MAX_SECRET_LENGTH || !['totp', 'hotp'].includes(account.type)
    || !isCounter(account.counter) || !Number.isFinite(account.position)
    || !Number.isSafeInteger(account.added) || account.added < 0) throw new Error('Invalid account');
  decodeBase32(account.secret);
  return account;
}

// Additional data binds each ciphertext to its place: a wrap to its vault's fixed header fields, an account to its key.
const bind = (fields) => encoder.encode(JSON.stringify(fields));
const wrapData = (vaultId, { version, created, kdf, iterations, salt }, wrap) => (
  bind({ version, vault: vaultId, created, kdf, iterations, salt, wrap }));
const checkData = (vaultId) => bind({ version: FORMAT, vault: vaultId, check: true });
const accountData = (vaultId, accountId) => bind({ version: FORMAT, vault: vaultId, account: accountId });
const countersData = (vaultId) => bind({ version: FORMAT, vault: vaultId, counters: true });

async function seal(key, additionalData, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: TAG * 8 }, key, bytes));
  const sealed = new Uint8Array(IV + data.length);
  sealed.set(iv);
  sealed.set(data, IV);
  return sealed.toBase64();
}

async function open(key, additionalData, text, length) {
  const sealed = decode(text, length);
  if (sealed.length < IV + TAG) throw new Error('Invalid vault');
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.subarray(0, IV), additionalData, tagLength: TAG * 8 }, key, sealed.subarray(IV)));
}

export async function passwordKey(password, salt) {
  const bytes = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  } finally {
    bytes.fill(0);
  }
}

// A random key needs no stretching, so HKDF is enough.
export async function recoveryKey(recovery, salt) {
  const material = await crypto.subtle.importKey('raw', recovery, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('Authenticator recovery key') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

// Extractable, so that the remembered unlock can keep it in storage.session.
export const importVaultKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

// Fails unless key is the vault key of this vault, even for a vault with no accounts.
export async function verifyVaultKey(key, vaultId, header) {
  await open(key, checkData(vaultId), header.check, CHECK);
}

export async function createVault(password, recovery) {
  const vaultId = randomId();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    const key = await importVaultKey(raw);
    const header = { version: FORMAT, created: Date.now(), kdf: KDF, iterations: ITERATIONS, salt: salt.toBase64() };
    header.password = await seal(await passwordKey(password, salt), wrapData(vaultId, header, 'password'), raw);
    header.recovery = await seal(await recoveryKey(recovery, salt), wrapData(vaultId, header, 'recovery'), raw);
    header.check = await seal(key, checkData(vaultId), new Uint8Array());
    return { vaultId, header, key };
  } finally {
    raw.fill(0);
  }
}

// wrap is 'password' or 'recovery'; wrapKey comes from passwordKey or recoveryKey with the header's salt.
export async function unwrapVaultKey(vaultId, header, wrap, wrapKey) {
  validateHeader(header);
  const raw = await open(wrapKey, wrapData(vaultId, header, wrap), header[wrap], WRAPPED);
  try {
    const key = await importVaultKey(raw);
    await verifyVaultKey(key, vaultId, header);
    return key;
  } finally {
    raw.fill(0);
  }
}

// The header with one wrap replaced. The salt never changes, so the other wrap stays valid.
export async function rewrap(vaultId, header, wrap, wrapKey, key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  try {
    return { ...header, [wrap]: await seal(wrapKey, wrapData(vaultId, header, wrap), raw) };
  } finally {
    raw.fill(0);
  }
}

// Every field but the ID, which the storage key holds, is sealed: the fields a later version added, and that this
// one does not know, are written back as they were read.
export async function sealAccount(key, vaultId, account) {
  const { id, ...fields } = validateAccount(account);
  const bytes = encoder.encode(JSON.stringify(fields));
  try {
    return await seal(key, accountData(vaultId, id), bytes);
  } finally {
    bytes.fill(0);
  }
}

// This computer's highest HOTP counters, { [accountKey]: counter }, sealed so that neither the keys nor an index of
// them are stored in the clear.
export async function sealCounters(key, vaultId, counters) {
  const bytes = encoder.encode(JSON.stringify(counters));
  try { return await seal(key, countersData(vaultId), bytes); } finally { bytes.fill(0); }
}

export async function openCounters(key, vaultId, text) {
  const bytes = await open(key, countersData(vaultId), text);
  try {
    const counters = JSON.parse(decoder.decode(bytes));
    if (!counters || typeof counters !== 'object' || Array.isArray(counters)
      || !Object.values(counters).every(isCounter)) throw new Error('Invalid counters');
    return counters;
  } finally {
    bytes.fill(0);
  }
}

// Keeps every sealed field, known or not. Only the six fields every version has are checked, so a field added later
// never makes an account damaged. The ID comes from the storage key, never from the sealed fields.
export async function openAccount(key, vaultId, id, text) {
  const bytes = await open(key, accountData(vaultId, id), text);
  try {
    return validateAccount({ ...JSON.parse(decoder.decode(bytes)), id });
  } finally {
    bytes.fill(0);
  }
}
