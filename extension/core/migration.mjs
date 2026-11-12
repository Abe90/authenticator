import { encodeBase32 } from './base32.mjs';
import { parseOtpAuth } from './otpauth.mjs';
import { cleanName, unnamedAccount } from './limits.mjs';
import { UserError } from './user-error.mjs';

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

// Reads one account of the export; a structural problem is reported against that account only.
function accountFields(entry) {
  let otp;
  try { otp = entry.wire === 2 ? fields(entry.value) : null; } catch { otp = null; }
  if (!otp) throw damaged();
  return (number, wire, fallback) => {
    try { return one(otp, number, wire, fallback); } catch { throw damaged(); }
  };
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

// The text of any authenticator QR code. It lives here, not in otpauth.mjs, which this module imports.
export function parseQrAccount(uri) {
  return /^otpauth-migration:/i.test(uri.trim()) ? parseMigration(uri) : parseOtpAuth(uri);
}
