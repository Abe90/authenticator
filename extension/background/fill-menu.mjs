import { RevealedCodes } from '../core/revealed-codes.mjs';
import { searchEntry } from '../core/search.mjs';
import { bySite, hostFromUrl } from '../core/sites.mjs';
import { UNLOCK_STORAGE_KEY } from '../core/storage-keys.mjs';
import { VaultSession } from '../core/vault.mjs';
import { fillAccount, fillField } from '../shared/fill-field.mjs';
import { closeBubble, showBubble } from './fill-bubble.mjs';
import { autoLock, fromPopupPage } from './open-windows.mjs';

// The "Authenticator" item of the context menu of editable fields. Its click grants activeTab for the tab, and a
// check injected into the clicked frame tells whether the field can take a code:
// 1. it cannot: the toolbar popup opens on its list, which copies;
// 2. the vault is unlocked and exactly one account matches the page: its code goes into the field;
// 3. none or several match: the accounts are listed under the field (background/fill-bubble.mjs), and the one chosen
//    fills it;
// 4. the vault is locked, or the list cannot show: the toolbar popup opens with a fill request, which it takes to ask
//    for the password if needed, then to fill the field (popup/ui/fill-page.mjs).
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

// Runs task(vault, accounts) with the remembered unlock, which the fill counts as use; the key stays only there, never
// in this session after the task. Resolves to null when the vault is locked.
async function withVault(task) {
  if (!(await autoLock.use())) return null;
  const vault = new VaultSession(browser.storage.sync, browser.storage.session, undefined, undefined,
    browser.storage.local);
  try {
    const accounts = await vault.restore();
    return accounts ? await task(vault, accounts) : null;
  } finally {
    vault.lock();
  }
}

const openPopup = (tab) => browser.action.openPopup({ windowId: tab.windowId }).catch(() => {});

// The toolbar popup takes over the field: it asks for the password if needed, then lists the accounts.
async function askPopup(tab, target) {
  request = { ...target, at: Date.now() };
  await openPopup(tab);
}

const enqueue = (task) => { queue = queue.then(task).catch(() => {}); };

// The account chosen in the list under the field fills it; a vault locked meanwhile asks for the password first.
async function fillChosen(tab, target, id) {
  const unlocked = await withVault(async (vault, accounts) => {
    const account = accounts.find((entry) => entry.id === id);
    if (account) await fillAccount(vault, revealed, account, target);
    return true;
  }).catch(() => true);
  if (!unlocked) await askPopup(tab, target);
}

async function fill(info, tab) {
  // A new click replaces the request or the list of an older one.
  request = null;
  closeBubble();
  // In a frame, the site that counts is the frame's own: the one that receives the code.
  const target = {
    tabId: tab.id, frameId: info.frameId ?? 0, targetElementId: info.targetElementId ?? null,
    host: hostFromUrl(info.frameUrl ?? info.pageUrl), incognito: tab.incognito === true,
  };
  // Firefox refuses the frame, or the field cannot take a code: the popup's list copies one.
  if (!(await fillField(target, null))) {
    await openPopup(tab);
    return;
  }
  // One account of the page fills the field at once, and a failure then, such as a field gone meanwhile, shows nothing
  // more; otherwise every account is listed, those of the page first.
  const found = await withVault(async (vault, accounts) => {
    const { matching, others } = bySite(accounts, target.host);
    if (matching.length === 1) {
      await fillAccount(vault, revealed, matching[0], target);
      return { filled: true };
    }
    return { rows: [...matching, ...others].map(searchEntry), matching: matching.length };
  }).catch(() => null);
  if (found?.filled) return;
  const choose = (id) => enqueue(() => fillChosen(tab, target, id));
  if (found?.rows.length && await showBubble(target, found.rows, found.matching, choose)) return;
  await askPopup(tab, target);
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
  if (info.menuItemId === ITEM && tab) enqueue(() => fill(info, tab));
});
// The list under a field shows names only while the vault is unlocked.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && UNLOCK_STORAGE_KEY in changes && !changes[UNLOCK_STORAGE_KEY].newValue) closeBubble();
});
browser.runtime.onMessage.addListener((message, sender) => {
  if (!fromPopupPage(sender) || message?.type !== 'take-fill-request') return undefined;
  return Promise.resolve(takeRequest(message.tabId));
});
