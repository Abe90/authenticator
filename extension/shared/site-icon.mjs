import { isSiteImage, wantsSiteIcon } from '../core/site-icons.mjs';
import { siteKey } from '../core/sites.mjs';
import { ICON_TRIED_KEY } from '../core/storage-keys.mjs';

// The icon of a site, taken from its page for the accounts without a bundled one (core/site-icons.mjs). The page
// itself is asked, in the tab that the user's click on the toolbar button or on the context menu opened to the
// extension (activeTab): the extension never contacts a site by itself, and needs no other permission.

// The side of the image kept, in pixels: twice the icon of the list, for screens of high density.
const SIZE = 48;
// How long the page has to give its icon.
const WAIT_MS = 2500;
// How many sites are remembered as asked.
const MAX_TRIED = 200;

// Runs in the page, as a content script, so Firefox serialises it: it uses nothing from around it. Tries the icons
// the page declares, the nearest to size first, then /favicon.ico, and resolves to the first that loads, drawn as a
// PNG image of at most size pixels a side, or to null.
async function pageIcon(size, wait) {
  const APPLE = 180;
  const UNKNOWN = 16;
  const declared = [...document.querySelectorAll('link[rel][href]')].flatMap((link) => {
    const rel = link.rel.toLowerCase().split(/\s+/);
    const apple = rel.some((word) => word.startsWith('apple-touch-icon'));
    if (!apple && !rel.includes('icon')) return [];
    const sides = [...(link.getAttribute('sizes') ?? '').matchAll(/(\d+)x\d+/gi)].map(([, side]) => Number(side));
    return [{ address: link.href, side: sides.length ? Math.max(...sides) : apple ? APPLE : UNKNOWN }];
  });
  // Large enough ones first, the smallest of them leading; then the others, the largest leading.
  const fits = (entry) => entry.side >= size;
  declared.sort((a, b) => (fits(a) !== fits(b) ? (fits(a) ? -1 : 1) : fits(a) ? a.side - b.side : b.side - a.side));
  const addresses = [...declared.slice(0, 4).map((entry) => entry.address), '/favicon.ico'];
  const signal = AbortSignal.timeout(wait);
  for (const address of addresses) {
    try {
      const url = new URL(address, location.href);
      if (!['https:', 'http:', 'data:'].includes(url.protocol)) continue;
      const response = await fetch(url, { signal });
      if (!response.ok) continue;
      const bitmap = await createImageBitmap(await response.blob());
      const longest = Math.max(bitmap.width, bitmap.height);
      if (!longest) continue;
      // A smaller image keeps its size: the list scales it.
      const scale = Math.min(1, size / longest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch { /* The next one. */ }
    if (signal.aborted) break;
  }
  return null;
}

// The icon of the page in target, { tabId, frameId }, as the page gives it now, or null; nothing is kept.
export async function readPageIcon(target, api = browser) {
  const [injection] = await api.scripting.executeScript({
    target: { tabId: target.tabId, frameIds: [target.frameId ?? 0] }, func: pageIcon, args: [SIZE, WAIT_MS],
  });
  return isSiteImage(injection?.result) ? injection.result : null;
}

// Takes the icon of the page in target, { tabId, frameId, host }, when one of accounts would show it and this
// computer has none for its site; a site is asked once between two starts of Firefox. Resolves to whether an icon was
// kept. The caller leaves out private windows.
export async function captureSiteIcon(vault, accounts, target, api = browser) {
  if (!target.host || !accounts.some((account) => wantsSiteIcon(account, target.host))) return false;
  const site = siteKey(target.host);
  if (isSiteImage((await vault.siteIcons())[site])) return false;
  const { [ICON_TRIED_KEY]: stored } = await api.storage.session.get(ICON_TRIED_KEY);
  const tried = Array.isArray(stored) ? stored : [];
  if (tried.includes(site)) return false;
  await api.storage.session.set({ [ICON_TRIED_KEY]: [...tried, site].slice(-MAX_TRIED) });
  const image = await readPageIcon(target, api);
  if (!image) return false;
  await vault.keepSiteIcon(site, image);
  return true;
}
