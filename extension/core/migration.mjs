import { encodeBase32 } from './base32.mjs';
import { parseOtpAuth } from './otpauth.mjs';
import { cleanName } from './limits.mjs';

const invalid = () => new Error('Invalid Google Authenticator export.');
const damaged = () => new Error('This account is damaged in the export.');
const utf8 = new TextDecoder('utf-8', { fatal: true });

function readText(bytes) {
  try { return cleanName(utf8.decode(bytes)); }
  catch { throw new Error('The account name is not valid text.'); }
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
    throw new Error('The export contains invalid Base64 data. Try a fresh QR image.');
  }
  let bytes;
  try { bytes = Uint8Array.fromBase64(encoded); }
  catch { throw new Error('The export data is incomplete. Try a clearer QR image.'); }
  try {
    const payload = fields(bytes);
    const version = one(payload, 2, 0, 0n);
    const batchSize = Number(one(payload, 3, 0, 0n)) || 1;
    const batchIndex = Number(one(payload, 4, 0, 0n));
    if (version > 2n) throw new Error(`Google export version ${version} is not supported yet.`);
    if (batchSize < 1 || batchSize > 1000 || batchIndex < 0 || batchIndex >= batchSize) {
      throw new Error('The Google export has invalid QR page information.');
    }
    const entries = payload.get(1) ?? [];
    if (!entries.length) throw new Error('No accounts found in the Google export.');
    if (entries.length > 1000) throw new Error('Too many accounts in this QR image.');
    const accounts = entries.map((entry) => {
      let name = 'Unnamed account';
      try {
        const field = accountFields(entry);
        const label = readText(field(2, 2, new Uint8Array()));
        const issuer = readText(field(3, 2, new Uint8Array()));
        name = !label ? issuer : issuer && !label.startsWith(`${issuer}:`) ? `${issuer}: ${label}` : label;
        // 0 is UNSPECIFIED, which Google reads as SHA-1 and six digits, like an otpauth URI without the parameter.
        if (![0n, 1n].includes(field(4, 0, 0n)) || ![0n, 1n].includes(field(5, 0, 0n))) {
          throw new Error('Only SHA-1 and six-digit codes are supported.');
        }
        const type = field(6, 0, 0n);
        if (![1n, 2n].includes(type)) throw new Error('Unsupported account type.');
        const secret = encodeBase32(field(1, 2, new Uint8Array()));
        const params = new URLSearchParams({ secret });
        if (type === 1n) params.set('counter', String(field(7, 0, 0n)));
        if (!label) throw new Error('Missing account name.');
        const record = parseOtpAuth(`otpauth://${type === 1n ? 'hotp' : 'totp'}/${encodeURIComponent(name)}?${params}`);
        return { name: record.name, record };
      } catch (error) {
        return { name: name || 'Unnamed account', error: error.message };
      }
    });
    return { kind: 'migration', accounts, batchSize, batchIndex };
  } finally { bytes.fill(0); }
}

// The text of any authenticator QR code. It lives here, not in otpauth.mjs, which this module imports.
export function parseQrAccount(uri) {
  return /^otpauth-migration:/i.test(uri.trim()) ? parseMigration(uri) : parseOtpAuth(uri);
}
