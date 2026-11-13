import { matchingAccounts } from '../../core/sites.mjs';
import { fillCode, fillField } from '../../shared/fill-field.mjs';
import { element } from './dom.mjs';

// Fill in a code: the toolbar popup that the context menu opened takes the field it was opened on, a fill request
// (background/fill-menu.mjs), once. When unlocked, exactly one account of the page fills the field at once;
// otherwise this page lists the accounts by name, those of the page first, then a line and the others. The one chosen
// fills the field and learns the page's site, except in a private window, and the popup closes. It never copies: a
// field that took nothing leaves the normal list, which does.
export function createFillPage({ vault, revealed, addWindow, onLeave }) {
  const list = element('#fill-accounts');
  // The request waiting to be taken, as the background script's answer, then the one this page fills.
  let pending = addWindow ? null : take();
  let request = null;
  let busy = false;

  async function take() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab ? await browser.runtime.sendMessage({ type: 'take-fill-request', tabId: tab.id }) : null;
    } catch { return null; }
  }

  // The code of account goes into the field; then the account learns the page's site, which it may have already, and
  // the popup closes. Resolves to false when the field took nothing.
  async function put(account) {
    const code = await fillCode(vault, revealed, account);
    if (!(await fillField(request, code))) return false;
    if (request.host && !request.incognito) await vault.learnSite(account.id, request.host).catch(() => {});
    request = null;
    window.close();
    return true;
  }

  function row(account) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fill-account';
    button.textContent = account.name;
    button.addEventListener('click', () => choose(account));
    return button;
  }

  // Once unlocked: 'fill' with this page ready to show, 'done' when a code went in and the popup is closing, or null
  // for the normal list: no request, no account, or a field that took nothing.
  async function prepare() {
    if (!pending) return null;
    const taken = await pending;
    pending = null;
    if (!taken) return null;
    const accounts = await vault.read().catch(() => []);
    if (!accounts.length) return null;
    request = taken;
    const matching = request.host ? matchingAccounts(accounts, request.host) : [];
    if (matching.length === 1) {
      const filled = await put(matching[0]).catch(() => false);
      if (!filled) request = null;
      return filled ? 'done' : null;
    }
    const others = accounts.filter((account) => !matching.includes(account));
    const rows = matching.map(row);
    if (matching.length && others.length) {
      const line = document.createElement('hr');
      line.className = 'fill-line';
      rows.push(line);
    }
    rows.push(...others.map(row));
    list.replaceChildren(...rows);
    return 'fill';
  }

  async function choose(account) {
    if (busy || !request) return;
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
    list.replaceChildren();
  }

  // Back to the normal list without filling: the back arrow, Escape, or a field that took nothing.
  function cancel() {
    if (busy) return;
    clear();
    onLeave();
  }

  return { prepare, cancel, clear, get busy() { return busy; } };
}
