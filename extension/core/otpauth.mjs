import { decodeBase32 } from './base32.mjs';
import { MAX_NAME_LENGTH, MAX_SECRET_LENGTH, cleanName, isCounter } from './limits.mjs';
import { TOTP_PERIOD } from './totp.mjs';
import { UserError } from './user-error.mjs';

export function parseOtpAuth(text) {
  if (typeof text !== 'string' || text.length > 8192) throw new UserError('qrInvalid');
  let url;
  try { url = new URL(text.trim()); } catch { throw new UserError('qrNotAccount'); }
  // The type is an opaque host, so the URL parser keeps its case; generators differ.
  const type = url.hostname.toLowerCase();
  if (url.protocol !== 'otpauth:' || !['totp', 'hotp'].includes(type)
    || url.username || url.password || url.port || url.hash) {
    throw new UserError('qrUnsupported');
  }
  for (const key of new Set(url.searchParams.keys())) {
    if (url.searchParams.getAll(key).length !== 1) throw new UserError('qrDuplicateParameters');
  }
  const params = url.searchParams;
  if ((params.get('algorithm') ?? 'SHA1').toUpperCase() !== 'SHA1'
    || (params.get('digits') ?? '6') !== '6'
    || (type === 'totp' && (params.get('period') ?? String(TOTP_PERIOD)) !== String(TOTP_PERIOD))) {
    throw new UserError('qrUnsupportedCode');
  }
  let label;
  try { label = cleanName(decodeURIComponent(url.pathname.slice(1))); }
  catch { throw new UserError('qrInvalidName'); }
  const issuer = cleanName(params.get('issuer') ?? '');
  const separator = label.indexOf(':');
  if (separator >= 0 && issuer && label.slice(0, separator).trim() !== issuer) {
    throw new UserError('qrConflictingProviders');
  }
  const name = issuer && separator < 0 ? `${issuer}: ${label}` : label;
  if (!label || name.length > MAX_NAME_LENGTH) throw new UserError('qrNameLength', MAX_NAME_LENGTH);
  const secret = (params.get('secret') ?? '').toUpperCase().replace(/\s/g, '');
  try {
    if (secret.length > MAX_SECRET_LENGTH) throw new Error();
    decodeBase32(secret);
  } catch { throw new UserError('qrInvalidSecret'); }
  let counter = '0';
  if (type === 'hotp') {
    // Google's PAM module omits the counter and Google's app then starts at 0.
    counter = params.get('counter') ?? '0';
    if (!isCounter(counter)) throw new UserError('qrInvalidCounter');
    counter = String(BigInt(counter));
  }
  return { name, secret, type, counter };
}
