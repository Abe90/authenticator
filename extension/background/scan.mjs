import { HANDOFF_STORAGE_KEY, SCAN_TARGET_KEY, UNLOCK_STORAGE_KEY } from '../core/storage-keys.mjs';
import { HANDOFF_MS, findAddCodeWindow, openAddCodeWindow } from '../shared/add-window.mjs';
import { SCAN_MESSAGES, scanPage } from './page-scan.mjs';

// Scan page runs here, since the toolbar popup closes when the page is clicked. The picked record stays in memory,
// never in storage, until the reopened popup or the Add code window takes it.
const RESULT_MS = 120_000;
let running = null;
let result = null;

const fromPopupPage = (sender) => sender.id === browser.runtime.id && typeof sender.url === 'string'
  && sender.url.startsWith(browser.runtime.getURL('popup/popup.html'));

function takeResult() {
  const taken = result && Date.now() - result.at < RESULT_MS ? { record: result.record, error: result.error } : null;
  result = null;
  return taken;
}

// "When the popup closes": the window opened after a pick belongs to the popup session that started the scan.
async function handOffUnlock() {
  const { [UNLOCK_STORAGE_KEY]: unlock } = await browser.storage.session.get(UNLOCK_STORAGE_KEY);
  if (unlock?.lockOnClose === true) {
    await browser.storage.session.set({ [HANDOFF_STORAGE_KEY]: Date.now() + HANDOFF_MS });
  }
}

async function scan() {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  result = null;
  // An Add code window that is already open would stay above the page, so it is out of the way meanwhile.
  const open = await findAddCodeWindow().catch(() => null);
  if (open) await browser.windows.update(open.id, { state: 'minimized' }).catch(() => {});
  let outcome = null;
  try {
    const record = await scanPage({ signal: controller.signal });
    if (record) outcome = { record };
  } catch (error) {
    outcome = { error: error.message || SCAN_MESSAGES.failed };
  }
  // A newer scan took over the page and the windows.
  if (running !== controller) return;
  running = null;
  const restore = () => (open
    ? browser.windows.update(open.id, { state: 'normal', focused: true }).catch(() => {})
    : null);
  if (!outcome) {
    await restore();
    return;
  }
  result = { ...outcome, at: Date.now() };
  await handOffUnlock().catch(() => {});
  // An Add code window that was open stays minimized: raising it would close the popup at once.
  const { [SCAN_TARGET_KEY]: scanTarget } = await browser.storage.session.get(SCAN_TARGET_KEY).catch(() => ({}));
  try {
    await browser.action.openPopup(Number.isSafeInteger(scanTarget?.windowId) ? { windowId: scanTarget.windowId } : {});
    return;
  } catch { /* Opening the popup without a click may be turned off; the Add code window takes over. */ }
  await restore();
  try { await openAddCodeWindow(); } catch {
    result = null;
    return;
  }
  // A window that was already open takes the result now; a new one asks for it when it starts.
  browser.runtime.sendMessage({ type: 'scan-result-ready' }).catch(() => {});
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!fromPopupPage(sender)) return undefined;
  if (message?.type === 'scan-page') scan();
  else if (message?.type === 'take-scan-result') return Promise.resolve(takeResult());
  return undefined;
});
