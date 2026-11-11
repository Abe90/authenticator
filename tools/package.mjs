// Builds the unsigned Mozilla upload archive and a readable source archive.
//
// Usage: node tools/package.mjs [--allow-dirty]
// A release is built from committed files only, so that its sources reproduce it; --allow-dirty
// builds from the working tree for local tries.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The folder Firefox loads. The upload archive holds its files at the top, next to the license.
export const EXTENSION = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');
// Files the extension never loads: the logo drawing and its export.
const ICON_SOURCES = new Set(['extension/assets/icons/logo.svg', 'extension/assets/icons/logo.png']);

/** The project-relative name of an absolute path, with forward slashes. */
export function name(path) {
  return relative(ROOT, path).split(sep).join('/');
}

/** The name of a file in the upload archive: relative to the extension folder, or to the project for the license. */
function packagedName(path) {
  const inside = relative(EXTENSION, path);
  return (inside.startsWith('..') ? relative(ROOT, path) : inside).split(sep).join('/');
}

/** Orders names folder by folder, so that the files of a folder stay together. */
function byName(a, b) {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

/** Orders paths by their project-relative names. */
export function byPath(a, b) {
  return byName(name(a), name(b));
}

export function isFile(path) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function filesIn(directory) {
  const folder = join(ROOT, directory);
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true }).map((entry) => join(folder, entry)).filter(isFile);
}

export function runtimeFiles() {
  const files = filesIn('extension').filter((path) => !ICON_SOURCES.has(name(path)));
  return [...files, join(ROOT, 'LICENSE')];
}

/** Files tracked by git, or null outside a git checkout, for example in an unpacked source archive. */
function tracked() {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  return new Set(listed.toString('utf8').split('\0').filter(Boolean).map((entry) => join(ROOT, entry)));
}

function sourceFiles() {
  const files = [...runtimeFiles(), join(ROOT, 'README.md'), join(ROOT, '.gitignore'), join(ROOT, '.gitattributes')];
  files.push(...filesIn('tools'));
  const known = tracked();
  // Drafts and local files that were never committed stay out of the published sources.
  return known ? files.filter((path) => known.has(path)) : files;
}

/** Packaged files that are untracked or differ from the last commit. */
function uncommitted(files) {
  const known = tracked();
  if (!known) return [];
  const status = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: ROOT })
    .toString('utf8');
  const changed = new Set(status.split('\0').filter((entry) => entry.length > 3)
    .map((entry) => join(ROOT, entry.slice(3))));
  return [...new Set(files.filter((path) => changed.has(path) || !known.has(path)))].sort(byPath);
}

// 1 January 2026, 00:00, in the DOS format of zip headers.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * A reproducible zip archive of the files: sorted entries, fixed timestamps and permissions.
 * It has no ZIP64 records, so it holds up to 65,535 files and 4 GiB.
 */
function archive(files, nameOf) {
  const parts = [];
  const directory = [];
  let offset = 0;
  const entries = [...new Set(files)].map((path) => [nameOf(path), path]).sort(([a], [b]) => byName(a, b));
  for (const [archiveName, path] of entries) {
    const data = readFileSync(path);
    const compressed = deflateRawSync(data);
    const entryName = Buffer.from(archiveName, 'utf8');
    // The fields that the local header and the central directory entry share.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed to extract: 2.0, for deflate
    common.writeUInt16LE(/^[\x00-\x7f]*$/.test(archiveName) ? 0 : 0x800, 2); // UTF-8 name flag
    common.writeUInt16LE(8, 4); // deflate
    common.writeUInt16LE(DOS_TIME, 6);
    common.writeUInt16LE(DOS_DATE, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(compressed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(entryName.length, 22);
    const local = Buffer.alloc(4);
    local.writeUInt32LE(0x04034b50, 0);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, zip 2.0
    common.copy(entry, 6);
    entry.writeUInt32LE((0o644 << 16) >>> 0, 38); // Unix permissions rw-r--r--
    entry.writeUInt32LE(offset, 42);
    parts.push(local, common, entryName, compressed);
    directory.push(entry, entryName);
    offset += local.length + common.length + entryName.length + compressed.length;
  }
  const size = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

function main() {
  const pending = uncommitted([...runtimeFiles(), ...sourceFiles()]);
  if (pending.length && !process.argv.slice(2).includes('--allow-dirty')) {
    console.error(`Commit these files first, or pass --allow-dirty:\n  ${pending.map(name).join('\n  ')}`);
    process.exit(1);
  }
  const { version } = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));
  mkdirSync(DIST, { recursive: true });
  for (const [fileName, files, nameOf] of [[`authenticator-${version}-unsigned.zip`, runtimeFiles(), packagedName],
    [`authenticator-${version}-source.zip`, sourceFiles(), name]]) {
    const bytes = archive(files, nameOf);
    writeFileSync(join(DIST, fileName), bytes);
    console.log(`${fileName}: ${bytes.length} bytes; SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
  }
}

if (import.meta.main) main();
