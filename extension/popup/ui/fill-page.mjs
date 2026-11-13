import { searchEntry } from '../../core/search.mjs';
import { bySite } from '../../core/sites.mjs';
import { fillAccount } from '../../shared/fill-field.mjs';
import { element } from './dom.mjs';
import { createFillList } from './fill-list.mjs';

// Fill in a code: the toolbar popup that the context menu opened, because the vault was locked or the list under the
// field could not show, takes the field it was opened on, a fill request (background/fill-menu.mjs), once.
// When unlocked, exactly one account of the page fills the field at once; otherwise this page lists the accounts
// (fill-list.mjs). The one chosen fills the field and learns the page's site, except in a private window, and the
// popup closes. It never copies: a field that took nothing leaves the normal list, which does.
export function createFillPage({ vault, revealed, addWindow, onLeave }) {
  const panel = element('#fill-panel');
  const list = createFillList(panel, { choose });
  // The request waiting to be taken, as the background script's answer, then the one this page fills, and the
  // accounts it lists.
  let pending = addWindow ? null : take();
  let request = null;
  let accounts = [];
  let busy = false;

  async function take() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab ? await browser.runtime.sendMessage({ type: 'take-fill-request', tabId: tab.id }) : null;
    } catch { return null; }
  }

  // The code of account goes into the field, and the popup closes. Resolves to false when the field took nothing.
  async function put(account) {
    if (!(await fillAccount(vault, revealed, account, request))) return false;
    request = null;
    window.close();
    return true;
  }

  // Once unlocked: 'fill' with this page ready to show, 'done' when a code went in and the popup is closing, or null
  // for the normal list: no request, no account, or a field that took nothing.
  async function prepare() {
    if (!pending) return null;
    const taken = await pending;
    pending = null;
    if (!taken) return null;
    const records = await vault.read().catch(() => []);
    if (!records.length) return null;
    request = taken;
    const { matching, others } = bySite(records, request.host);
    if (matching.length === 1) {
      const filled = await put(matching[0]).catch(() => false);
      if (!filled) request = null;
      return filled ? 'done' : null;
    }
    accounts = [...matching, ...others];
    list.render(accounts.map(searchEntry), matching.length);
    return 'fill';
  }

  async function choose(id) {
    const account = accounts.find((entry) => entry.id === id);
    if (busy || !request || !account) return;
    busy = true;
    let filled = false;
    try { filled = await put(account); } catch { filled = false; }
    busy = false;
    if (!filled) cancel();
  }

  // Forgets the request and the list: a lock, or leaving the page.
  function clear() {
    pending = null;
    request = null;
    accounts = [];
    list.clear();
  }

  // Back to the normal list without filling: the back arrow, Escape, or a field that took nothing.
  function cancel() {
    if (busy) return;
    clear();
    onLeave();
  }

  panel.addEventListener('keydown', list.onKey);
  return { prepare, cancel, clear, get busy() { return busy; } };
}
