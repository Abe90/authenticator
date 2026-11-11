// Each extension window, the toolbar popup or the Add code window, holds a port to the background script, which
// records when the last one closes (background/open-windows.mjs): a timed unlock counts from then.
export const WINDOW_PORT = 'extension-window';
// Firefox stops the event page after 30 seconds without events, which would drop the ports and miss the close.
// Messages on a port count as events.
const PING_MS = 10_000;

// Holds this window's port until the returned function runs. A port lost because the background script stopped is
// opened again, which starts it; one refused at once is tried again a second later rather than in a loop.
export function announceWindow(api = browser) {
  let port = null;
  let pinger = 0;
  let retry = 0;
  let closed = false;

  function connect() {
    const since = Date.now();
    try {
      port = api.runtime.connect({ name: WINDOW_PORT });
    } catch { return; }
    pinger = setInterval(() => {
      try { port.postMessage('ping'); } catch { /* Lost: onDisconnect connects again. */ }
    }, PING_MS);
    port.onDisconnect.addListener(() => {
      clearInterval(pinger);
      if (!closed) retry = setTimeout(connect, Date.now() - since < 1000 ? 1000 : 0);
    });
  }

  connect();
  return () => {
    closed = true;
    clearInterval(pinger);
    clearTimeout(retry);
    try { port?.disconnect(); } catch { /* Already closed. */ }
  };
}
