import { AUTO_LOCK_ALARM, AutoLock } from '../core/auto-lock.mjs';
import { UNLOCK_STORAGE_KEY, isId } from '../core/storage-keys.mjs';
import { WINDOW_PORT } from '../shared/open-windows.mjs';

// The auto-lock: which windows hold the remembered unlock, and its end when the last one closes, when its time
// runs out, and when this event page starts again after Firefox stopped it (core/auto-lock.mjs). A page cannot record
// its own close: Firefox drops storage calls made while a window closes. The windows' pings keep this event page
// running while one is open.
const page = browser.runtime.getURL('popup/popup.html');
export const autoLock = new AutoLock({ session: browser.storage.session, alarms: browser.alarms });

// Whether a message or a port comes from the extension's own page: the toolbar popup or the Add code window.
export const fromPopupPage = (sender) => sender?.id === browser.runtime.id && typeof sender.url === 'string'
  && sender.url.startsWith(page);

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== WINDOW_PORT || !fromPopupPage(port.sender)) return;
  const kind = new URL(port.sender.url).searchParams.get('view') === 'add' ? 'add' : 'popup';
  let windowId = null;
  const reply = (id, ok) => {
    try { port.postMessage({ type: 'reply', id, ok }); } catch { /* The window closed. */ }
  };
  const ask = (id, question) => { question().catch(() => false).then((ok) => reply(id, ok)); };
  port.onMessage.addListener((message) => {
    if (message?.type === 'hello' && windowId === null && isId(message.windowId)) {
      windowId = message.windowId;
      autoLock.connected(windowId, port, isId(message.holding) ? message.holding : null).catch(() => {});
      return;
    }
    if (windowId === null || !message || typeof message !== 'object') return;
    const { id } = message;
    if (message.type === 'claim' && isId(message.sessionId)) {
      ask(id, () => autoLock.claim(windowId, message.sessionId, kind));
    } else if (message.type === 'release') {
      autoLock.release(windowId).catch(() => {});
    } else if (message.type === 'input') {
      autoLock.input(windowId, message.at).catch(() => {});
    } else if (message.type === 'hand-off' && message.to === 'add') {
      ask(id, () => autoLock.handOff(windowId, 'add'));
    } else if (message.type === 'cancel-hand-off' && message.to === 'add') {
      autoLock.cancelHandOff(windowId, 'add').catch(() => {});
    } else if (Number.isSafeInteger(id)) reply(id, false);
  });
  port.onDisconnect.addListener(() => {
    if (windowId !== null) autoLock.disconnected(windowId, port).catch(() => {});
  });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) autoLock.check().catch(() => {});
});
// A new unlock, a changed setting or a revoke: the next time that matters may have moved.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && UNLOCK_STORAGE_KEY in changes) autoLock.check().catch(() => {});
});
autoLock.start().catch(() => {});
