// A QR code of a text, as ISO/IEC 18004 describes it: bytes (UTF-8), error correction level L, which holds the most
// and is enough for an image shown on a screen. encodeQr(text) gives the smallest version that holds the text.

const MAX_VERSION = 40;
// For level L, by version from 1: the error correction codewords of each block, and the number of blocks.
const ECC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30,
  26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16,
  17, 18, 19, 19, 20, 21, 22, 24, 25];
// The two bits that name level L in the format information.
const LEVEL_L = 1;

const sizeOf = (version) => version * 4 + 17;

// The centres of the alignment patterns along one side.
function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = sizeOf(version) - 7; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

// The codewords a version holds, data and error correction together.
function totalCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    modules -= (25 * count - 10) * count - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

const dataCodewords = (version) => totalCodewords(version) - ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1];
// The bits of the byte count, which follow the four of the mode.
const countBits = (version) => (version < 10 ? 8 : 16);

// The bytes of a text one QR code can hold.
export const QR_CAPACITY = dataCodewords(MAX_VERSION) - 3;

// Reed-Solomon over GF(256), with the polynomial x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x, y) {
  let z = 0;
  for (let bit = 7; bit >= 0; bit--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> bit) & 1) * x;
  }
  return z;
}

function divisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data, generator) {
  const result = new Array(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    generator.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor); });
  }
  return result;
}

// The data codewords of the text: mode, count, bytes, terminator and padding.
function dataOf(bytes, version) {
  const capacity = dataCodewords(version) * 8;
  const bits = [];
  const push = (value, length) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  push(4, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  return data;
}

// Splits the data into blocks, adds each block's error correction, and interleaves them.
function withErrorCorrection(data, version) {
  const count = BLOCKS[version - 1];
  const ecc = ECC_PER_BLOCK[version - 1];
  const total = totalCodewords(version);
  const short = count - (total % count);
  const shortLength = Math.floor(total / count) - ecc;
  const generator = divisor(ecc);
  const blocks = [];
  for (let index = 0, start = 0; index < count; index++) {
    const block = data.slice(start, start + shortLength + (index < short ? 0 : 1));
    start += block.length;
    blocks.push({ data: block, ecc: remainder(block, generator) });
  }
  const result = [];
  for (let index = 0; index <= shortLength; index++) {
    for (const block of blocks) if (index < block.data.length) result.push(block.data[index]);
  }
  for (let index = 0; index < ecc; index++) for (const block of blocks) result.push(block.ecc[index]);
  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// How hard a pattern is to read, by the four rules of the standard: the mask with the lowest penalty is used.
function penalty(modules, size) {
  let result = 0;
  let dark = 0;
  const line = (at) => {
    let run = 1;
    let history = 0;
    for (let index = 0; index < size; index++) {
      const module = at(index);
      if (index && module === at(index - 1)) {
        run++;
        if (run === 5) result += 3;
        else if (run > 5) result++;
      } else run = 1;
      // A finder-like pattern, dark light dark dark dark light dark, with four light modules on one side.
      history = ((history << 1) | module) & 0x7ff;
      if (index >= 10 && (history === 0x5d0 || history === 0x05d)) result += 40;
    }
  };
  for (let y = 0; y < size; y++) {
    line((x) => modules[y * size + x]);
    for (let x = 0; x < size; x++) dark += modules[y * size + x];
  }
  for (let x = 0; x < size; x++) line((y) => modules[y * size + x]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const module = modules[y * size + x];
      if (module === modules[y * size + x + 1] && module === modules[(y + 1) * size + x]
        && module === modules[(y + 1) * size + x + 1]) result += 3;
    }
  }
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

function build(codewords, version) {
  const size = sizeOf(version);
  const modules = new Uint8Array(size * size);
  // The modules of the patterns, the format and the version, which carry no data and take no mask.
  const reserved = new Uint8Array(size * size);
  const set = (x, y, dark) => {
    modules[y * size + x] = dark ? 1 : 0;
    reserved[y * size + x] = 1;
  };

  for (let index = 0; index < size; index++) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((centerX, i) => positions.forEach((centerY, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));

  function drawFormat(mask) {
    const data = (LEVEL_L << 3) | mask;
    let rest = data;
    for (let index = 0; index < 10; index++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
    const bits = ((data << 10) | rest) ^ 0x5412;
    const bit = (index) => ((bits >>> index) & 1) === 1;
    for (let index = 0; index <= 5; index++) set(8, index, bit(index));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let index = 9; index < 15; index++) set(14 - index, 8, bit(index));
    for (let index = 0; index < 8; index++) set(size - 1 - index, 8, bit(index));
    for (let index = 8; index < 15; index++) set(8, size - 15 + index, bit(index));
    set(8, size - 8, true);
  }
  drawFormat(0);
  if (version >= 7) {
    let rest = version;
    for (let index = 0; index < 12; index++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let index = 0; index < 18; index++) {
      const dark = ((bits >>> index) & 1) === 1;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // The codewords, in columns of two modules from the right, up and down in turn.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (reserved[y * size + x] || index >= codewords.length * 8) continue;
        modules[y * size + x] = (codewords[index >>> 3] >>> (7 - (index & 7))) & 1;
        index++;
      }
    }
  }

  const apply = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y * size + x] && MASKS[mask](x, y)) modules[y * size + x] ^= 1;
      }
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty(modules, size);
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
    // The same mask again takes it off.
    apply(mask);
  }
  apply(best);
  drawFormat(best);
  return { size, modules };
}

// The QR code of text: { size, modules }, with modules[y * size + x] 1 for a dark module. Throws when the text is
// longer than a QR code holds.
export function encodeQr(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && 4 + countBits(version) + bytes.length * 8 > dataCodewords(version) * 8) version++;
  if (version > MAX_VERSION) throw new Error('Too long for a QR code');
  // jsQR, which reads the QR codes here (shared/qr-worker.mjs), has a wrong alignment pattern for version 23.
  if (version === 23) version = 24;
  return build(withErrorCorrection(dataOf(bytes, version), version), version);
}
