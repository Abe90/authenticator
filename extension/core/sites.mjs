import { MAX_SITES } from './limits.mjs';

// The sites of an account: an optional list of entries such as { host: 'github.com' }, sealed with the account. A
// list may hold entries this version cannot read, from a damaged write or a later version: they are left out of
// every use here and kept as they are in the list (the format rules in the README).
const MAX_HOST_LENGTH = 253;
// Labels of letters, digits, hyphens and underscores (punycode included), or an IPv6 address in brackets.
const HOST_SHAPE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)$/;

// A host as URL.hostname gives it, and only that: lower case, ASCII (punycode), an IPv6 address in brackets, no
// port, no empty label and no final dot.
export function isHost(text) {
  if (typeof text !== 'string' || text.length > MAX_HOST_LENGTH || !HOST_SHAPE.test(text)) return false;
  try { return new URL(`https://${text}/`).hostname === text; } catch { return false; }
}

// The host of an http or https address, or null.
export function hostFromUrl(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/\.$/, '');
  return isHost(host) ? host : null;
}

// The host that a typed site or a pasted address stands for, or null: github.com, GitHub.com/login and
// https://github.com/login all give github.com, and bücher.de gives its punycode.
export function hostFromText(text) {
  const typed = String(text).trim();
  if (!typed || /\s/.test(typed)) return null;
  return hostFromUrl(/^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
}

// Firefox's Public Suffix List, which the manifest's publicSuffix permission gives.
function suffixList() {
  const list = globalThis.browser?.publicSuffix;
  if (!list) throw new Error('The publicSuffix API is missing');
  return list;
}

// What two hosts share when they are the same site: their registrable domain, from Firefox's Public Suffix List,
// so that myaccount.google.com is accounts.google.com and mario.github.io is not luigi.github.io; or the whole host
// when it has none: IP addresses and local names such as nas, router.lan and nas.local. getDomain keeps its default
// options, which give null for those: allowUnknownSuffix would return the last two labels, making a.corp.lan the
// same site as b.corp.lan.
export function siteKey(host) {
  const list = suffixList();
  let domain = null;
  // Firefox's list may refuse a host that URL accepts: the whole host then stands for the site.
  try { domain = list.getDomain(host); } catch { /* No registrable domain. */ }
  return domain ?? host;
}

// A host as the pages show it: its registrable domain, or its last two labels when it has none (bücher.de1, a local
// name), readable (Unicode) unless Firefox keeps them in punycode because they could imitate another name, as with
// mixed scripts; the labels before them as stored. Only showing takes these options: siteKey keeps the defaults.
export function displayHost(host) {
  const list = suffixList();
  const options = { allowUnknownSuffix: true, allowPlainSuffix: true };
  let domain = null;
  let shown = null;
  try {
    domain = list.getDomain(host, options);
    if (domain) shown = list.getDomain(host, { ...options, encoding: 'display' });
  } catch { return host; }
  if (!domain || !shown || !host.endsWith(domain)) return host;
  return host.slice(0, host.length - domain.length) + shown;
}

const isSite = (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) && isHost(entry.host);

// The entries of a site list this version can use; a value that is not a list has none.
export const validSites = (value) => (Array.isArray(value) ? value.filter(isSite) : []);

// The accounts that have host's site among theirs.
export function matchingAccounts(accounts, host) {
  const key = siteKey(host);
  return accounts.filter((account) => validSites(account.sites).some((site) => siteKey(site.host) === key));
}

// Adds entries to the account's sites: each valid one joins last, with its fields, unless the account has its site
// already, while the account has fewer than MAX_SITES valid sites. The entries already there stay as they are, and a
// value that is not a list counts as an empty one; the account changes only when an entry joins.
export function addSites(account, entries) {
  const valid = validSites(account.sites);
  const keys = new Set(valid.map((entry) => siteKey(entry.host)));
  const list = Array.isArray(account.sites) ? [...account.sites] : [];
  let count = valid.length;
  for (const entry of validSites(entries)) {
    if (count >= MAX_SITES) break;
    const key = siteKey(entry.host);
    if (keys.has(key)) continue;
    keys.add(key);
    list.push({ ...entry });
    count++;
  }
  if (count > valid.length) account.sites = list;
}

// Removes the account's valid sites whose host is one of hosts. A list left empty goes: a missing list means no
// sites.
export function removeSites(account, hosts) {
  if (!Array.isArray(account.sites)) return;
  const removed = new Set(hosts);
  const list = account.sites.filter((entry) => !(isSite(entry) && removed.has(entry.host)));
  if (list.length === account.sites.length) return;
  if (list.length) account.sites = list;
  else delete account.sites;
}
