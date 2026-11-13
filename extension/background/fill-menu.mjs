import { RevealedCodes } from '../core/revealed-codes.mjs';
import { hostFromUrl, matchesHost } from '../core/sites.mjs';
import { VaultSession } from '../core/vault.mjs';
import { fillCode, fillField } from '../shared/fill-field.mjs';
import { autoLock, fromPopupPage } from './open-windows.mjs';

// The "Authenticator" item of the context menu of editable fields. Its click grants activeTab for the tab, and a
// check injected into the clicked frame tells whether the field can take a code:
// 1. it cannot: the toolbar popup opens on its list, which copies;
// 2. the vault is unlocked and exactly one account matches the page: its code goes into the field;
// 3. none or several match, 4. or the vault is locked: the toolbar popup opens with a fill request, which it takes to
//    ask for the password if needed, then to fill the field (popup/ui/fill-page.mjs).
const ITEM = 'fill';
const PROPERTIES = {
  title: browser.runtime.getManifest().name,
  contexts: ['editable', 'password'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
};
// How long a fill request waits for the popup of its tab.
const REQUEST_MS = 120_000;
const revealed = new RevealedCodes(browser.storage.session);
// Clicks are handled one after the other, so that two fills never interleave.
let queue = Promise.resolve();
// The field of the last click, for the popup: { tabId, frameId, targetElementId, host, incognito, at }. It stays in
// memory only, and the popup's port keeps this event page running while the popup shows.
let request = null;

// The code of the only account whose sites match host, or null: the vault is locked, or no account matches, or
// several do.
async function soleCode(host) {
  if (!host || !(await autoLock.use())) return null;
  const vault = new VaultSession(browser.storage.sync, browser.storage.session, undefined, undefined,
    browser.storage.local);
  try {
    const matching = (await vault.restore() ?? []).filter((account) => matchesHost(account, host));
    return matching.length === 1 ? await fillCode(vault, revealed, matching[0]) : null;
  } finally {
    // The key stays only in the remembered unlock.
    vault.lock();
  }
}

const openPopup = (tab) => browser.action.openPopup({ windowId: tab.windowId }).catch(() => {});

async function fill(info, tab) {
  // A new click replaces the request of an older one.
  request = null;
  const target = { tabId: tab.id, frameId: info.frameId ?? 0, targetElementId: info.targetElementId ?? null };
  // Firefox refuses the frame, or the field cannot take a code: the popup's list copies one.
  if (!(await fillField(target, null))) {
    await openPopup(tab);
    return;
  }
  // In a frame, the site that counts is the frame's own: the one that receives the code.
  const host = hostFromUrl(info.frameUrl ?? info.pageUrl);
  let code = null;
  try { code = await soleCode(host); } catch { code = null; }
  if (code !== null) {
    // A failure now, such as a field gone meanwhile, shows nothing more.
    await fillField(target, code);
    return;
  }
  request = { ...target, host, incognito: tab.incognito === true, at: Date.now() };
  await openPopup(tab);
}

// The fill request for the popup of tabId, taken once; an older one, or one for another tab, stays out.
function takeRequest(tabId) {
  if (request && Date.now() - request.at >= REQUEST_MS) request = null;
  if (!request || request.tabId !== tabId) return null;
  const taken = request;
  request = null;
  return taken;
}

// Created at every start of the event page. Firefox may have kept the item from an earlier start, and then refuses an
// ID it already has: the kept item takes the current properties instead.
browser.menus.create({ id: ITEM, ...PROPERTIES }, () => {
  if (browser.runtime.lastError) browser.menus.update(ITEM, PROPERTIES).catch(() => {});
});
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ITEM || !tab) return;
  queue = queue.then(() => fill(info, tab)).catch(() => {});
});
browser.runtime.onMessage.addListener((message, sender) => {
  if (!fromPopupPage(sender) || message?.type !== 'take-fill-request') return undefined;
  return Promise.resolve(takeRequest(message.tabId));
});
