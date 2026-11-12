import { SCAN_TARGET_KEY } from '../core/storage-keys.mjs';
import { findAddCodeWindow, openAddCodeWindow } from '../shared/add-window.mjs';
import { errorText, t } from '../shared/i18n.mjs';
import { scanPage } from './page-scan.mjs';
import { autoLock } from './open-windows.mjs';

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

// holder: the scan's hold on the unlock of the window that started it, or null (core/auto-lock.mjs). The scan keeps
// the unlock while the popup is closed, and hands it on to the window that shows a picked code.
async function scan(holder) {
  const ended = (picked) => (holder ? autoLock.scanEnded(holder, picked).catch(() => {}) : null);
  running?.abort();
  const controller = new AbortController();
  running = controller;
  result = null;
  // An Add code window that is already open would stay above the page, so it is out of the way meanwhile.
  const open = await findAddCodeWindow().catch(() => null);
  if (open) await browser.windows.update(open.id, { state: 'minimized' }).catch(() => {});
  let outcome = null;
  try {
    const record = await scanPage({
      signal: controller.signal,
      // The overlay reports the user's input, which keeps the unlock from ending for inactivity during the scan.
      onInput: (at) => { if (holder) autoLock.input(holder, at).catch(() => {}); },
    });
    if (record) outcome = { record };
  } catch (error) {
    outcome = { error: errorText(error, t('scanFailed')) };
  }
  // A newer scan took over the page and the windows.
  if (running !== controller) {
    await ended(false);
    return;
  }
  running = null;
  const restore = () => (open
    ? browser.windows.update(open.id, { state: 'normal', focused: true }).catch(() => {})
    : null);
  if (!outcome) {
    await ended(false);
    await restore();
    return;
  }
  result = { ...outcome, at: Date.now() };
  // A failure shows only its message, which needs no unlock.
  await ended(Boolean(outcome.record));
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

// Answers once the scan holds the unlock of the window that started it, which may then close.
async function startScan(windowId) {
  const holder = await autoLock.scanStarted(windowId).catch(() => null);
  scan(holder);
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!fromPopupPage(sender)) return undefined;
  if (message?.type === 'scan-page') return startScan(message.windowId);
  else if (message?.type === 'take-scan-result') return Promise.resolve(takeResult());
  return undefined;
});
