import { randomId } from '../core/storage-keys.mjs';

// Each extension window, the toolbar popup or the Add code window, holds a port to the background script, which
// decides whether the window may hold the remembered unlock and ends it when the last holder closes
// (background/open-windows.mjs, core/auto-lock.mjs).
export const WINDOW_PORT = 'extension-window';
// Firefox stops the event page after 30 seconds without events, which would drop the ports and miss the close.
// Messages on a port count as events.
const PING_MS = 10_000;
// A port that could not be opened, or was lost at once, is tried again after this long rather than in a loop.
const RETRY_MS = 1000;
// How long a question to the background script waits for its answer; no answer counts as a no.
const REPLY_MS = 5000;
// The user's input, which keeps an unlock this window holds from ending for inactivity, reaches the background
// script at most this often, with the time of the latest input.
const INPUT_MS = 15_000;
// Typing, clicking, scrolling and moving the pointer, never events a script sends.
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'];

// Calls report(time of the latest input) for trusted input on target, at most every INPUT_MS and once more after
// the last input. Returns the function that stops it.
export function watchInput(target, report) {
  let latest = 0;
  let sent = 0;
  let timer = 0;
  function send() {
    timer = 0;
    sent = Date.now();
    report(latest);
  }
  function seen(event) {
    if (!event.isTrusted) return;
    latest = Date.now();
    if (timer) return;
    const wait = sent + INPUT_MS - latest;
    if (wait <= 0) send();
    else timer = setTimeout(send, wait);
  }
  for (const type of INPUT_EVENTS) target.addEventListener(type, seen, { capture: true, passive: true });
  return () => {
    clearTimeout(timer);
    for (const type of INPUT_EVENTS) target.removeEventListener(type, seen, { capture: true });
  };
}

// Holds this window's port until close() runs. A port lost because the background script stopped is opened again,
// which starts it, and tells it again who this window is and which unlock it holds. While it holds one, the user's
// input in this window is reported.
export function announceWindow(api = browser, target = globalThis) {
  const windowId = randomId();
  let port = null;
  let pinger = 0;
  let retry = 0;
  let closed = false;
  // The sessionId of the unlock the background script granted this window, until it locks.
  let holding = null;
  let requests = 0;
  const waiting = new Map();

  function send(message) {
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch { return false; }
  }

  function connect() {
    if (closed) return;
    const since = Date.now();
    let opened;
    try {
      opened = api.runtime.connect({ name: WINDOW_PORT });
    } catch {
      retry = setTimeout(connect, RETRY_MS);
      return;
    }
    port = opened;
    opened.onMessage.addListener((message) => {
      if (message?.type !== 'reply') return;
      waiting.get(message.id)?.(message.ok === true);
    });
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = null;
      clearInterval(pinger);
      for (const answer of [...waiting.values()]) answer(false);
      if (!closed) retry = setTimeout(connect, Date.now() - since < RETRY_MS ? RETRY_MS : 0);
    });
    send({ type: 'hello', windowId, holding });
    pinger = setInterval(() => send('ping'), PING_MS);
  }

  // Resolves to the background script's yes or no.
  function ask(message) {
    const id = ++requests;
    return new Promise((resolve) => {
      const timer = setTimeout(() => answer(false), REPLY_MS);
      function answer(ok) {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(ok);
      }
      waiting.set(id, answer);
      if (!send({ ...message, id })) answer(false);
    });
  }

  connect();
  const unwatch = watchInput(target, (at) => { if (holding) send({ type: 'input', at }); });
  return {
    windowId,
    // Asks to hold the unlock with this sessionId; a no leaves this window locked.
    async claim(sessionId) {
      const granted = await ask({ type: 'claim', sessionId });
      holding = granted ? sessionId : null;
      // An answer lost on the way may have been a yes.
      if (!granted) send({ type: 'release' });
      return granted;
    },
    // This window locked.
    release() {
      holding = null;
      send({ type: 'release' });
    },
    // The Add code window ('add') opened next may take over the unlock that this window holds.
    handOff: (to) => ask({ type: 'hand-off', to }),
    cancelHandOff(to) { send({ type: 'cancel-hand-off', to }); },
    close() {
      closed = true;
      unwatch();
      clearInterval(pinger);
      clearTimeout(retry);
      for (const answer of [...waiting.values()]) answer(false);
      try { port?.disconnect(); } catch { /* Already closed. */ }
    },
  };
}
