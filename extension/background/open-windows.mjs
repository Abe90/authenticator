import { CLOSED_STORAGE_KEY } from '../core/storage-keys.mjs';
import { WINDOW_PORT } from '../shared/open-windows.mjs';

// Records when the last extension window closes. A page cannot record its own close: Firefox drops storage calls made
// while a window closes. The windows' pings keep this event page running while one is open.
const page = browser.runtime.getURL('popup/popup.html');
const open = new Set();

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== WINDOW_PORT || port.sender?.id !== browser.runtime.id
    || typeof port.sender.url !== 'string' || !port.sender.url.startsWith(page)) return;
  open.add(port);
  port.onMessage.addListener(() => {});
  port.onDisconnect.addListener(() => {
    open.delete(port);
    if (!open.size) browser.storage.session.set({ [CLOSED_STORAGE_KEY]: Date.now() }).catch(() => {});
  });
});
