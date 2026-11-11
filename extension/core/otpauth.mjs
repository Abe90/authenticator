import { decodeBase32 } from './base32.mjs';
import { MAX_NAME_LENGTH, MAX_SECRET_LENGTH, isCounter } from './limits.mjs';
import { TOTP_PERIOD } from './totp.mjs';

export function parseOtpAuth(text) {
  if (typeof text !== 'string' || text.length > 8192) throw new Error('Invalid authenticator QR code.');
  let url;
  try { url = new URL(text.trim()); } catch { throw new Error('This QR code is not an authenticator account.'); }
  // The type is an opaque host, so the URL parser keeps its case; generators differ.
  const type = url.hostname.toLowerCase();
  if (url.protocol !== 'otpauth:' || !['totp', 'hotp'].includes(type)
    || url.username || url.password || url.port || url.hash) {
    throw new Error('This QR code is not a supported authenticator account.');
  }
  for (const key of new Set(url.searchParams.keys())) {
    if (url.searchParams.getAll(key).length !== 1) throw new Error('The QR code contains duplicate parameters.');
  }
  const params = url.searchParams;
  if ((params.get('algorithm') ?? 'SHA1').toUpperCase() !== 'SHA1'
    || (params.get('digits') ?? '6') !== '6'
    || (type === 'totp' && (params.get('period') ?? String(TOTP_PERIOD)) !== String(TOTP_PERIOD))) {
    throw new Error('Only SHA-1, six-digit codes and a 30-second TOTP period are supported.');
  }
  let label;
  try { label = decodeURIComponent(url.pathname.slice(1)).trim(); }
  catch { throw new Error('The QR code has an invalid account name.'); }
  const issuer = (params.get('issuer') ?? '').trim();
  const separator = label.indexOf(':');
  if (separator >= 0 && issuer && label.slice(0, separator).trim() !== issuer) {
    throw new Error('The QR code contains conflicting account providers.');
  }
  const name = issuer && separator < 0 ? `${issuer}: ${label}` : label;
  if (!label || name.length > MAX_NAME_LENGTH) throw new Error('The account name must contain 1 to 100 characters.');
  const secret = (params.get('secret') ?? '').toUpperCase().replace(/\s/g, '');
  try {
    if (secret.length > MAX_SECRET_LENGTH) throw new Error();
    decodeBase32(secret);
  } catch { throw new Error('The QR code contains an invalid secret key.'); }
  let counter = '0';
  if (type === 'hotp') {
    // Google's PAM module omits the counter and Google's app then starts at 0.
    counter = params.get('counter') ?? '0';
    if (!isCounter(counter)) throw new Error('The QR code contains an invalid HOTP counter.');
    counter = String(BigInt(counter));
  }
  return { name, secret, type, counter };
}
