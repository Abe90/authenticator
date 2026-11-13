import { t } from '../../shared/i18n.mjs';
import { recordScanTarget } from './scan-target.mjs';

// Scan page starts right after the toolbar click that grants the tab. The background keeps the pick until the
// popup it reopens takes it, or the Add code window where Firefox refuses to reopen the popup.
export function createScanResult({ addWindow, session, form, scanConfirm, notice, blocked, onError }) {
  // The toolbar popup records its tab and takes a waiting result at once; the result lives only here until shown.
  const targetRecorded = addWindow ? null : recordScanTarget().catch(() => {});
  let pending = addWindow ? null : browser.runtime.sendMessage({ type: 'take-scan-result' }).catch(() => null);

  async function start() {
    if (blocked()) return;
    await targetRecorded;
    // The background answers once the scan holds this window's unlock, which it hands on to the window that shows a
    // picked code: this popup may then close.
    try { await browser.runtime.sendMessage({ type: 'scan-page', windowId: session.windowId }); }
    catch {
      onError(t('scanStartFailed'));
      return;
    }
    // The toolbar popup would cover the page; a popup page opened in a tab, as in the tests, stays.
    try { if (browser.extension.getViews({ type: 'popup' }).includes(window)) window.close(); }
    catch { /* It closes anyway when the page gets the focus. */ }
  }

  // The toolbar popup, once unlocked: the page that shows a waiting result, filled while still hidden ('scan' or
  // 'notice'), or null to open on the list. The popup opens straight on that page; a result is taken once.
  async function prepare() {
    if (addWindow || !pending || !session.unlocked) return null;
    const result = await pending;
    pending = null;
    if (!result || !session.unlocked) return null;
    if (result.error) {
      notice.fill(t('cantAddTitle'), result.error, 'list');
      return 'notice';
    }
    return scanConfirm.show(result.record, result.host);
  }

  // The Add code window, on its form: a waiting result fills it.
  async function take() {
    if (!addWindow || !session.unlocked) return;
    try {
      const result = await browser.runtime.sendMessage({ type: 'take-scan-result' });
      if (result && session.unlocked) form.applyScanResult(result);
    } catch { /* No background script to answer: nothing was scanned. */ }
  }

  // A lock loses a scanned code that was not saved.
  function clear() {
    pending = null;
    scanConfirm.clear();
  }

  // The background script has a result: an Add code window that is already open takes it now.
  if (addWindow) {
    browser.runtime.onMessage.addListener((note, sender) => {
      if (sender.id === browser.runtime.id && note?.type === 'scan-result-ready') take();
    });
  }
  return { start, prepare, take, clear };
}
