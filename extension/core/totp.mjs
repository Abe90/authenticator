import { decodeBase32 } from './base32.mjs';
import { MAX_COUNTER } from './limits.mjs';

export const TOTP_PERIOD = 30;

export const totpStep = (seconds) => BigInt(Math.floor(seconds / TOTP_PERIOD));

// Google Authenticator's minimum for keys typed by hand (EnterKeyActivity.MIN_KEY_BYTES), to catch a key copied
// in part. RFC 4226 asks for 16 bytes, but many services use 10.
export const MIN_MANUAL_KEY_BYTES = 10;

export function isShortManualKey(secret) {
  return decodeBase32(secret).length < MIN_MANUAL_KEY_BYTES;
}

// Imports the HMAC key once, for an account that generates codes while it is shown.
export async function createHotpGenerator(secret) {
  const key = await crypto.subtle.importKey(
    'raw', decodeBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  return async (count, digits = 6) => {
    if ((typeof count !== 'bigint' && !Number.isSafeInteger(count)) || ![6, 8].includes(digits)) {
      throw new Error('Invalid HOTP parameters');
    }
    if (BigInt(count) < 0n || BigInt(count) > MAX_COUNTER) throw new Error('Invalid counter');
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(0, BigInt(count));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
    const offset = signature[signature.length - 1] & 15;
    const value = new DataView(signature.buffer).getUint32(offset) & 0x7fffffff;
    return String(value % (10 ** digits)).padStart(digits, '0');
  };
}
