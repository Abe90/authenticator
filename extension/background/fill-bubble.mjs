import { randomId } from '../core/storage-keys.mjs';

// The list of accounts under a field, for the context menu when the vault is unlocked and none or several accounts
// match the page (background/fill-menu.mjs). Two pieces meet here:
// - content/fill-bubble.js, injected into the field's frame, which places the list and tells when it must go;
// - popup/bubble.html, the list itself, an extension page in a frame inside a closed shadow root: the page can
//   neither read nor reach it, nor learn its address.
// The names go from here to the list page only, and only to the frame that the injected script made for this request:
// the page must present the one-time token the script put in the frame's address, from the frame whose ID the script
// reported. The page never gets a name; only, after a choice, the code (background/fill-menu.mjs).

const CONTENT_FILE = '/content/fill-bubble.js';
const CONTENT_PORT = 'fill-bubble';
const LIST_PORT = 'fill-bubble-list';
const PAGE = browser.runtime.getURL('popup/bubble.html');
// The list must show within this long, or the toolbar popup lists the accounts instead: a page that blocks the frame.
const READY_MS = 3000;
// The list closes by itself after this long, as a fill request expires.
const OPEN_MS = 120_000;
// How long the injected script has to confirm a choice.
const CHECK_MS = 2000;
// Room for any real list; a larger height from the list page is cut to it.
const MAX_HEIGHT = 2000;

// The list showing, or about to: { target, rows, matching, choose, token, content, list, frameId, hello, greeted,
// settle, checked, timer, choosing }.
let current = null;

// Shows rows, [{ id, name, search, icon, image }] with the matching first, under the field of target ({ tabId, frameId,
// targetElementId }); the caller has closed any list showing (closeBubble). choose(id) runs once the user picks an
// account and the injected script confirms the list was there to be seen. Resolves to whether the list showed; false
// when it could not, and the caller falls back to the toolbar popup.
export function showBubble(target, rows, matching, choose) {
  const bubble = {
    target, rows, matching, choose, token: randomId(), content: null, list: null, frameId: null, hello: null,
    greeted: false, settle: null, checked: null, timer: 0, choosing: false,
  };
  const shown = new Promise((resolve) => { bubble.settle = resolve; });
  current = bubble;
  bubble.timer = setTimeout(() => finish(bubble), READY_MS);
  browser.scripting.executeScript({
    target: { tabId: target.tabId, frameIds: [target.frameId] }, files: [CONTENT_FILE],
  }).catch(() => finish(bubble));
  return shown;
}

// Closes the list, if one shows: another click of the menu, or the vault locked.
export function closeBubble() {
  if (current) finish(current);
}

// Ends bubble: the injected script removes the list, and gives the field back the keyboard when refocus is set (Escape
// or Tab in the list). A caller of showBubble still waiting learns that the list did not show.
function finish(bubble, refocus = false) {
  if (current !== bubble) return;
  current = null;
  clearTimeout(bubble.timer);
  bubble.settle(false);
  bubble.checked?.('closed');
  // The injected script removes the list and closes its port itself, after the message.
  try { bubble.content?.postMessage({ type: 'close', refocus }); } catch { /* The page is gone. */ }
  try { bubble.list?.disconnect(); } catch { /* The list is gone. */ }
}

function connectContent(port) {
  const bubble = current;
  const { sender } = port;
  if (!bubble || bubble.content || sender?.id !== browser.runtime.id || sender.tab?.id !== bubble.target.tabId
    || (sender.frameId ?? 0) !== bubble.target.frameId) {
    port.disconnect();
    return;
  }
  bubble.content = port;
  port.onMessage.addListener((message) => onContent(bubble, message));
  // The page navigated or closed, or the list went because of something on the page.
  port.onDisconnect.addListener(() => finish(bubble));
  port.postMessage({ type: 'open', targetElementId: bubble.target.targetElementId, token: bubble.token });
}

function onContent(bubble, message) {
  if (current !== bubble || !message || typeof message !== 'object') return;
  if (message.type === 'frame' && bubble.frameId === null && Number.isSafeInteger(message.frameId)
    && message.frameId > 0) {
    bubble.frameId = message.frameId;
    greet(bubble);
  } else if (message.type === 'shown') {
    clearTimeout(bubble.timer);
    bubble.timer = setTimeout(() => finish(bubble), OPEN_MS);
    bubble.settle(true);
  } else if (message.type === 'checked') {
    bubble.checked?.(message.result);
  }
  // 'keepalive' messages only keep this event page running while the list shows.
}

function connectList(port) {
  const bubble = current;
  const { sender } = port;
  if (!bubble || bubble.list || sender?.id !== browser.runtime.id || typeof sender.url !== 'string'
    || !sender.url.startsWith(PAGE) || sender.tab?.id !== bubble.target.tabId) {
    port.disconnect();
    return;
  }
  bubble.list = port;
  port.onMessage.addListener((message) => onList(bubble, message));
  port.onDisconnect.addListener(() => finish(bubble));
}

// The names go to the list once its page has shown the token, from the frame the injected script reported.
function greet(bubble) {
  if (bubble.greeted || bubble.frameId === null || bubble.hello === null || !bubble.list) return;
  if (bubble.hello !== bubble.token || bubble.list.sender.frameId !== bubble.frameId) {
    finish(bubble);
    return;
  }
  bubble.greeted = true;
  bubble.list.postMessage({ type: 'rows', rows: bubble.rows, matching: bubble.matching });
}

function onList(bubble, message) {
  if (current !== bubble || !message || typeof message !== 'object') return;
  if (message.type === 'hello') {
    if (bubble.hello !== null || typeof message.token !== 'string') {
      finish(bubble);
      return;
    }
    bubble.hello = message.token;
    greet(bubble);
    return;
  }
  if (!bubble.greeted) return;
  if (message.type === 'size' && Number.isFinite(message.height) && message.height >= 0) {
    bubble.content?.postMessage({ type: 'size', height: Math.min(Math.ceil(message.height), MAX_HEIGHT) });
  } else if (message.type === 'choose' && typeof message.id === 'string'
    && [message.at, message.x, message.y].every(Number.isFinite)) {
    choose(bubble, message.id, { at: message.at, x: message.x, y: message.y });
  } else if (message.type === 'blur') {
    // The injected script tells whether the keyboard went to the page or out of it.
    bubble.content?.postMessage({ type: 'blur' });
  } else if (message.type === 'cancel') {
    finish(bubble, message.refocus === true);
  }
}

// The injected script confirms that the list and the field were there to be seen when the user clicked, at time at
// on the point x, y of the list page: resolves to 'ok', 'early' (a click too soon after the list appeared or moved,
// ignored), or anything else for a list that must go.
function check(bubble, { at, x, y }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => bubble.checked?.('timeout'), CHECK_MS);
    bubble.checked = (result) => {
      clearTimeout(timer);
      bubble.checked = null;
      resolve(result);
    };
    try { bubble.content.postMessage({ type: 'check', at, x, y }); } catch { bubble.checked('closed'); }
  });
}

async function choose(bubble, id, click) {
  if (bubble.choosing || !bubble.rows.some((row) => row.id === id)) return;
  bubble.choosing = true;
  const result = await check(bubble, click);
  if (current !== bubble) return;
  bubble.choosing = false;
  if (result === 'early') {
    bubble.list?.postMessage({ type: 'ignored' });
    return;
  }
  finish(bubble);
  if (result === 'ok') bubble.choose(id);
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name === CONTENT_PORT) connectContent(port);
  else if (port.name === LIST_PORT) connectList(port);
});
