import { hostFromUrl } from '../../core/sites.mjs';
import { SCAN_TARGET_KEY } from '../../core/storage-keys.mjs';

// The activeTab grant belongs to the tab where the toolbar popup opened, so the popup records it each time, with the
// host of its page, which the Add code window proposes as a site (null for a page that is not http or https).
export async function recordScanTarget(api = browser) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await api.storage.session.set({
      [SCAN_TARGET_KEY]: { tabId: tab.id, windowId: tab.windowId, host: hostFromUrl(tab.url) },
    });
  }
}
