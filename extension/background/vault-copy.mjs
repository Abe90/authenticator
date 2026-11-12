import { VaultCopy } from '../core/vault-copy.mjs';
import { parseItem } from '../core/storage-keys.mjs';

// Keeps this computer's copy of the vault in line with Firefox Sync, and keeps a lost vault aside for the user to
// restore, also while no popup is open: Firefox wakes this event page for storage.onChanged, also for the changes
// sync brings. Nothing here writes to Firefox Sync.
const copy = new VaultCopy(browser.storage.sync, browser.storage.local);
const refresh = () => { copy.refresh().catch(() => {}); };

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((name) => parseItem(name))) refresh();
});
browser.runtime.onStartup.addListener(refresh);
browser.runtime.onInstalled.addListener(refresh);
