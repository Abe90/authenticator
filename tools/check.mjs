// Repeatable static checks, with no dependencies beyond Node.js.
//
// - Text files are UTF-8 without a BOM, use LF line endings, end with a newline and have no
//   trailing whitespace. Vendored files are left as upstream ships them.
// - Every JavaScript module and page script passes `node --check`.
// - Every file the extension loads exists and is in the release package from tools/package.mjs,
//   and every packaged file is loaded, apart from licenses and notices. References are followed
//   from the manifest (popup, background scripts, icons, web-accessible pages) through HTML
//   attributes, CSS url(), module imports, worker URLs, asset paths in scripts and page scripts
//   injected with scripting.executeScript. A manifest with default_locale loads every
//   _locales/*/messages.json.
// - Every message the extension asks for is in every language, with the same $1, $2… as in English, and every
//   message is asked for. Keys are read from t('key'), plural('key') (key_one and key_other), UserError('key'),
//   getMessage('key'), data-i18n attributes and __MSG_key__ in the manifest.
//
// Usage: node tools/check.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { EXTENSION, ROOT, byPath, isFile, name, runtimeFiles } from './package.mjs';

const TEXT = new Set(['.mjs', '.js', '.html', '.css', '.json', '.md', '.svg', '.gitignore', '.gitattributes']);
const SKIP = ['extension/vendor/', 'LICENSE'];
const problems = [];

function projectFiles() {
  const listed = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: ROOT }).toString('utf8');
  return listed.split('\0').filter(Boolean).map((entry) => join(ROOT, entry)).filter(isFile).sort(byPath);
}

function checkText(path) {
  const data = readFileSync(path);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) problems.push(`${name(path)}: starts with a UTF-8 BOM`);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data); // drops a leading BOM
  } catch {
    problems.push(`${name(path)}: not valid UTF-8`);
    return;
  }
  if (text.includes('\r')) problems.push(`${name(path)}: has CR line endings`);
  if (text && !text.endsWith('\n')) problems.push(`${name(path)}: does not end with a newline`);
  text.split('\n').forEach((line, index) => {
    if (line !== line.trimEnd()) problems.push(`${name(path)}:${index + 1}: trailing whitespace`);
  });
}

function checkSyntax(modules) {
  for (const path of modules) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status) problems.push(`${name(path)}: ${result.stderr.trim()}`);
  }
}

const PATTERNS = {
  '.html': [/\b(?:src|href)="([^"]+)"/g],
  '.css': [/url\('([^']+)'\)/g],
  // The last pattern: page scripts that scripting.executeScript injects, named by absolute path.
  '.mjs': [/\bfrom '([^']+)'/g, /\bimport '([^']+)'/g, /\bimport\('([^']+)'\)/g,
    /new URL\('([^']+)', import\.meta\.url\)/g, /'(\/content\/[^']+\.js)'/g],
};
// Asset paths in scripts resolve against the page that runs them, not the module.
const PAGE_ASSETS = /['"]((?:\.\.\/)*assets\/(?:icons|fonts)\/[^'"]+)['"]/g;

function references(path, page) {
  const patterns = PATTERNS[extname(path)];
  if (!patterns) return [];
  const text = readFileSync(path, 'utf8');
  const found = [];
  for (const pattern of patterns) {
    for (const [, target] of text.matchAll(pattern)) found.push([dirname(path), target]);
  }
  if (extname(path) === '.mjs') {
    for (const [, target] of text.matchAll(PAGE_ASSETS)) found.push([page, target]);
  }
  return found;
}

function loadedFiles() {
  const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));
  const pending = [manifest.action.default_popup, ...(manifest.background?.scripts ?? []),
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources)]
    .map((file) => join(EXTENSION, file));
  const page = pending[0];
  const loaded = new Set([join(EXTENSION, 'manifest.json')]);
  if (manifest.default_locale) pending.push(...localeFiles());
  while (pending.length) {
    const path = pending.pop();
    if (loaded.has(path)) continue;
    loaded.add(path);
    if (!isFile(path)) {
      problems.push(`${name(path)}: referenced but missing`);
      continue;
    }
    for (const [base, reference] of references(path, dirname(page))) {
      if (/^[a-z][a-z0-9+.-]*:/.test(reference) || reference.startsWith('#')) continue;
      const target = reference.split('?')[0].split('#')[0];
      pending.push(target.startsWith('/') ? join(EXTENSION, target.replace(/^\/+/, '')) : resolve(base, target));
    }
  }
  return loaded;
}

function localeFiles() {
  return readdirSync(join(EXTENSION, '_locales')).map((locale) => join(EXTENSION, '_locales', locale, 'messages.json'));
}

const KEYS = [/\b(?:t|UserError|getMessage)\('(\w+)'/g, /\bdata-i18n(?:-[a-z-]+)?="(\w+)"/g, /__MSG_(\w+)__/g];
const PLURAL_KEYS = /\bplural\('(\w+)'/g;
const places = (message) => [...new Set(message.match(/\$\d/g))].sort().join(' ');

function checkMessages(loaded) {
  const used = new Set();
  for (const path of loaded) {
    if (!['.mjs', '.js', '.html', '.json'].includes(extname(path)) || !isFile(path)) continue;
    if (name(path).startsWith('extension/_locales/')) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of KEYS) for (const [, key] of text.matchAll(pattern)) used.add(key);
    for (const [, key] of text.matchAll(PLURAL_KEYS)) used.add(`${key}_one`).add(`${key}_other`);
  }
  const english = JSON.parse(readFileSync(join(EXTENSION, '_locales', 'en', 'messages.json'), 'utf8'));
  for (const path of localeFiles()) {
    if (!isFile(path)) continue;
    const messages = JSON.parse(readFileSync(path, 'utf8'));
    const lower = new Set();
    for (const [key, { message }] of Object.entries(messages)) {
      // Firefox reads keys without regard to case.
      if (lower.has(key.toLowerCase())) problems.push(`${name(path)}: ${key} differs from another key only by case`);
      lower.add(key.toLowerCase());
      if (!used.has(key)) problems.push(`${name(path)}: ${key} is never used`);
      if (!message) problems.push(`${name(path)}: ${key} is empty`);
      if (english[key] && places(message ?? '') !== places(english[key].message)) {
        problems.push(`${name(path)}: ${key} does not have the $1, $2… of English`);
      }
    }
    for (const key of [...used].sort()) {
      if (!(key in messages)) problems.push(`${name(path)}: ${key} is missing`);
    }
  }
}

function checkPackage(loaded) {
  const packaged = new Set(runtimeFiles());
  for (const path of [...loaded].filter((path) => !packaged.has(path)).sort(byPath)) {
    if (isFile(path)) problems.push(`${name(path)}: loaded by the extension but not packaged`);
  }
  for (const path of [...packaged].filter((path) => !loaded.has(path)).sort(byPath)) {
    if (!/(LICENSE|NOTICE|README|OFL)/.test(basename(path))) problems.push(`${name(path)}: packaged but never loaded`);
  }
}

const files = projectFiles();
for (const path of files) {
  const relativeName = name(path);
  if ((TEXT.has(extname(path)) || TEXT.has(basename(path))) && !SKIP.some((prefix) => relativeName.startsWith(prefix))) {
    checkText(path);
  }
}
checkSyntax(files.filter((path) => extname(path) === '.mjs' || name(path).startsWith('extension/content/')));
const loaded = loadedFiles();
checkPackage(loaded);
checkMessages(loaded);
for (const problem of problems) console.log(problem);
console.log(problems.length ? `${problems.length} problems` : 'ok');
process.exitCode = problems.length ? 1 : 0;
