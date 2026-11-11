const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Ignores case, spaces and padding. Leftover bits are dropped, as other authenticator apps do.
export function decodeBase32(text) {
  const normalized = text.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized) || [1, 3, 6].includes(normalized.length % 8)) {
    throw new Error('Invalid Base32 key');
  }
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    buffer = (buffer << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (!bytes.length) throw new Error('Invalid Base32 key');
  return new Uint8Array(bytes);
}

// Unpadded, as authenticator apps write keys.
export function encodeBase32(bytes) {
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits) text += ALPHABET[(buffer << (5 - bits)) & 31];
  return text;
}
