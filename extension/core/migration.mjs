import { decodeBase32, encodeBase32 } from './base32.mjs';
import { parseOtpAuth } from './otpauth.mjs';
import { MAX_SITES, cleanName, unnamedAccount } from './limits.mjs';
import { isHost, validSites } from './sites.mjs';
import { UserError } from './user-error.mjs';

// Google's format has no place for the sites of an account. Our own export (migrationUris) adds them to each account
// as one more field, repeated, of a message with the host in its field 1: Google Authenticator skips a field it does
// not know, and this reader takes it.
const SITES_FIELD = 1000;

const invalid = () => new UserError('exportInvalid');
const damaged = () => new UserError('exportDamagedAccount');
const utf8 = new TextDecoder('utf-8', { fatal: true });

function readText(bytes) {
  try { return cleanName(utf8.decode(bytes)); }
  catch { throw new UserError('exportInvalidName'); }
}

// Bounded protobuf reader. Unknown fields are skipped for forward compatibility.
function fields(bytes) {
  let offset = 0;
  function integer() {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw invalid();
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        if (value > 0xffffffffffffffffn) throw invalid();
        return value;
      }
    }
    throw invalid();
  }
  const result = new Map();
  while (offset < bytes.length) {
    const tag = integer();
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (!field || field > 0x1fffffff) throw invalid();
    let value;
    if (wire === 0) value = integer();
    else if ([1, 2, 5].includes(wire)) {
      const length = wire === 2 ? Number(integer()) : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || length > bytes.length - offset) throw invalid();
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else throw invalid();
    if (!result.has(field)) result.set(field, []);
    result.get(field).push({ wire, value });
  }
  return result;
}

function one(message, field, wire, fallback) {
  const entries = message.get(field);
  if (!entries) return fallback;
  if (entries.length !== 1 || entries[0].wire !== wire) throw invalid();
  return entries[0].value;
}

// Reads one account of the export; a structural problem is reported against that account only. The function it
// returns reads one field; its sites are the valid hosts of our own export's field, without repeats, and whatever
// else the field holds is left out.
function accountFields(entry) {
  let otp;
  try { otp = entry.wire === 2 ? fields(entry.value) : null; } catch { otp = null; }
  if (!otp) throw damaged();
  const field = (number, wire, fallback) => {
    try { return one(otp, number, wire, fallback); } catch { throw damaged(); }
  };
  field.sites = () => {
    const sites = [];
    for (const { wire, value } of otp.get(SITES_FIELD) ?? []) {
      if (sites.length >= MAX_SITES) break;
      try {
        const host = wire === 2 ? utf8.decode(one(fields(value), 1, 2, new Uint8Array())) : '';
        if (isHost(host) && !sites.some((site) => site.host === host)) sites.push({ host });
      } catch { /* Not a site this version reads. */ }
    }
    return sites;
  };
  return field;
}

export function parseMigration(uri) {
  if (typeof uri !== 'string' || uri.length > 32768) throw invalid();
  let url;
  try { url = new URL(uri.trim()); } catch { throw invalid(); }
  if (url.protocol !== 'otpauth-migration:' || url.hostname !== 'offline'
    || url.username || url.password || url.port || url.hash || !['', '/'].includes(url.pathname)
    || url.searchParams.getAll('data').length !== 1) throw invalid();
  const encoded = url.searchParams.get('data').replace(/[ -]/g, '+').replace(/_/g, '/');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new UserError('exportInvalidData');
  }
  let bytes;
  try { bytes = Uint8Array.fromBase64(encoded); }
  catch { throw new UserError('exportIncomplete'); }
  try {
    const payload = fields(bytes);
    const version = one(payload, 2, 0, 0n);
    const batchSize = Number(one(payload, 3, 0, 0n)) || 1;
    const batchIndex = Number(one(payload, 4, 0, 0n));
    if (version > 2n) throw new UserError('exportVersion', String(version));
    if (batchSize < 1 || batchSize > 1000 || batchIndex < 0 || batchIndex >= batchSize) {
      throw new UserError('exportPages');
    }
    const entries = payload.get(1) ?? [];
    if (!entries.length) throw new UserError('exportEmpty');
    if (entries.length > 1000) throw new UserError('exportTooMany');
    const accounts = entries.map((entry) => {
      let name = unnamedAccount();
      try {
        const field = accountFields(entry);
        const label = readText(field(2, 2, new Uint8Array()));
        const issuer = readText(field(3, 2, new Uint8Array()));
        name = !label ? issuer : issuer && !label.startsWith(`${issuer}:`) ? `${issuer}: ${label}` : label;
        // 0 is UNSPECIFIED, which Google reads as SHA-1 and six digits, like an otpauth URI without the parameter.
        if (![0n, 1n].includes(field(4, 0, 0n)) || ![0n, 1n].includes(field(5, 0, 0n))) {
          throw new UserError('exportUnsupportedCode');
        }
        const type = field(6, 0, 0n);
        if (![1n, 2n].includes(type)) throw new UserError('exportUnsupportedType');
        const secret = encodeBase32(field(1, 2, new Uint8Array()));
        const params = new URLSearchParams({ secret });
        if (type === 1n) params.set('counter', String(field(7, 0, 0n)));
        if (!label) throw new UserError('exportMissingName');
        const record = parseOtpAuth(`otpauth://${type === 1n ? 'hotp' : 'totp'}/${encodeURIComponent(name)}?${params}`);
        const sites = field.sites();
        if (sites.length) record.sites = sites;
        return { name: record.name, record };
      } catch (error) {
        // The error crosses from the background script to the popup, so it is a plain { key, values } for a message.
        const { key, values } = error instanceof UserError ? error : damaged();
        return { name: name || unnamedAccount(), error: { key, values } };
      }
    });
    return { kind: 'migration', accounts, batchSize, batchIndex };
  } finally { bytes.fill(0); }
}

// The export: accounts as QR codes that parseMigration and Google Authenticator read.
const EXPORT_PREFIX = 'otpauth-migration://offline?data=';
// A QR code of the export holds at most this many accounts, as Google's do, and a text of at most this length, which
// keeps it easy to read from a screen; an account alone may make a longer one.
const MAX_BATCH_ACCOUNTS = 10;
const MAX_URI_LENGTH = 700;
const encoder = new TextEncoder();

function varint(value) {
  const bytes = [];
  let rest = BigInt(value);
  do {
    const byte = Number(rest & 127n);
    rest >>= 7n;
    bytes.push(rest ? byte | 128 : byte);
  } while (rest);
  return bytes;
}
const numberField = (field, value) => [...varint(field << 3), ...varint(value)];
const bytesField = (field, bytes) => [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
const textField = (field, text) => bytesField(field, encoder.encode(text));

// Our single name goes back into Google's issuer and name, at its first ": ", so that reading the export joins them
// into the same name again.
function splitName(name) {
  const separator = name.indexOf(': ');
  const issuer = separator > 0 ? name.slice(0, separator).trim() : '';
  const label = issuer ? name.slice(separator + 2).trim() : '';
  // A name the reader would not join back the same way stays whole.
  return issuer && label && !label.startsWith(`${issuer}:`) ? { issuer, label } : { issuer: '', label: name };
}

function accountMessage({ name, secret, type, counter, sites }) {
  const { issuer, label } = splitName(cleanName(name) || unnamedAccount());
  return [
    ...bytesField(1, decodeBase32(secret)),
    ...textField(2, label),
    ...(issuer ? textField(3, issuer) : []),
    // SHA-1, six digits.
    ...numberField(4, 1),
    ...numberField(5, 1),
    ...numberField(6, type === 'hotp' ? 1 : 2),
    ...(type === 'hotp' ? numberField(7, BigInt(counter)) : []),
    ...validSites(sites).slice(0, MAX_SITES).flatMap(({ host }) => bytesField(SITES_FIELD, textField(1, host))),
  ];
}

function exportUri(messages, batchSize, batchIndex, batchId) {
  const payload = Uint8Array.from([
    ...messages.flatMap((message) => bytesField(1, message)),
    ...numberField(2, 1),
    ...numberField(3, batchSize),
    ...(batchIndex ? numberField(4, batchIndex) : []),
    ...numberField(5, batchId),
  ]);
  try { return EXPORT_PREFIX + encodeURIComponent(payload.toBase64()); } finally { payload.fill(0); }
}

// The texts of the QR codes that export accounts ({ name, secret, type, counter, sites }), in order: one, or several
// that each say which part of the export they are, as Google's do.
export function migrationUris(accounts) {
  if (!accounts.length) throw new Error('Select at least one account');
  const batches = [];
  let batch = [];
  for (const message of accounts.map(accountMessage)) {
    // Measured with the longest page numbers an export can have.
    const fits = batch.length < MAX_BATCH_ACCOUNTS
      && exportUri([...batch, message], 1000, 999, 0x7fffffff).length <= MAX_URI_LENGTH;
    if (batch.length && !fits) {
      batches.push(batch);
      batch = [];
    }
    batch.push(message);
  }
  batches.push(batch);
  const batchId = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
  return batches.map((messages, index) => exportUri(messages, batches.length, index, batchId));
}

// The text of any authenticator QR code. It lives here, not in otpauth.mjs, which this module imports.
export function parseQrAccount(uri) {
  return /^otpauth-migration:/i.test(uri.trim()) ? parseMigration(uri) : parseOtpAuth(uri);
}
