import { SCAN_TARGET_KEY } from '../../core/storage-keys.mjs';

// The activeTab grant belongs to the tab where the toolbar popup opened, so the popup records it each time.
export async function recordScanTarget(api = browser) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab) await api.storage.session.set({ [SCAN_TARGET_KEY]: { tabId: tab.id, windowId: tab.windowId } });
}
