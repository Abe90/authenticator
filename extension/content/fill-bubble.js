// Injected into the frame of a field the context menu was opened on, when the vault is unlocked and none or several
// accounts match the page: shows the list of accounts (popup/bubble.html) under the field, or above it without room
// below, in a frame inside a closed shadow root, in the top layer (background/fill-bubble.mjs). It never sees a name
// or a code, and acts on trusted events only. The list goes on a click in the page, Escape, the field scrolled away
// or gone, the page hidden, the keyboard gone to another window or to Firefox's own bars, or anything the page does
// to it.
(() => {
  const KEY = Symbol.for('authenticator.fillBubble');
  globalThis[KEY]?.destroy(false);

  // Between the field and the list, and between the list and the edges of the frame.
  const GAP = 4;
  const MARGIN = 8;
  // The list is as wide as the field, within these.
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 360;
  // Without this much room above or below the field, the toolbar popup lists the accounts instead.
  const MIN_ROOM = 80;
  // A click this soon after the list appeared or moved is ignored: the page may have moved it under the pointer.
  const SETTLE_MS = 500;
  // Focus that left the list or the page is looked at after this long, once Firefox has moved it.
  const FOCUS_MS = 100;
  // The raised shadow of the popup (--shadow-raised in popup/popup.css), light or dark as the list is.
  const SHADOW = '0 2px 8px light-dark(#0000002e, #00000080), 0 1px 2px light-dark(#00000024, #00000066)';
  // What the page could change to hide the list, move it, paint over it or take it out of the top layer; each is set
  // as important on the element's own style, which wins over every rule of the page. A change to that style removes
  // the list. The light or dark scheme is Firefox's, for the shadow and the list page.
  const LOCKED_STYLE = {
    display: 'block', position: 'fixed', inset: 'auto', margin: '0', padding: '0', border: '0', outline: 'none',
    width: 'auto', height: 'auto', overflow: 'visible', background: 'transparent', opacity: '1',
    visibility: 'visible', transform: 'none', translate: 'none', scale: 'none', rotate: 'none', filter: 'none',
    'backdrop-filter': 'none', 'clip-path': 'none', mask: 'none', 'mix-blend-mode': 'normal', 'pointer-events': 'auto',
    zoom: '1', contain: 'none', 'content-visibility': 'visible', transition: 'none', animation: 'none',
    'color-scheme': 'light dark',
  };
  const port = browser.runtime.connect({ name: 'fill-bubble' });
  let field = null;
  let host = null;
  let frame = null;
  // The height the list page asked for; where this script put the frame, and where it was at the last frame,
  // measured, in this frame's viewport; and when it last moved.
  let height = 0;
  let placed = null;
  let framed = null;
  let placedAt = 0;
  let shown = false;
  let frameTask = 0;
  let destroyed = false;
  // Firefox stops an idle background script after 30 seconds, even with this port open; a message resets that.
  const keepAlive = setInterval(() => {
    try { port.postMessage({ type: 'keepalive' }); } catch { /* The port closed; destroy() follows. */ }
  }, 10_000);

  // Whether records show the page removing or moving the list, or changing its attributes.
  const tampered = (records) => records.some((record) => record.type === 'attributes'
    || [...record.removedNodes].includes(host));

  // Sets properties as important, and drops the records of this change. Records still waiting come from the page,
  // whose code may have run since the observer last reported, inside showPopover: they remove the list instead.
  // Returns whether the list is still there.
  function important(element, properties) {
    if (tampered(observer.takeRecords())) {
      destroy(false);
      return false;
    }
    for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value, 'important');
    observer.takeRecords();
    return true;
  }

  // Shows the list in the top layer. The page's beforetoggle listeners run inside, and may remove the list or change
  // it, which the observer or the next important() then reports: returns whether the list is open.
  function show() {
    try { host.showPopover(); } catch { /* The page removed it. */ }
    return host.matches(':popover-open');
  }

  // A modal dialog makes everything outside it inert: the list goes inside the field's, when it has one.
  function container(node) {
    for (let at = node; at; at = at.parentElement ?? at.getRootNode().host ?? null) {
      if (at.localName === 'dialog' && at.matches(':modal')) return at;
    }
    return document.documentElement;
  }

  function open(targetElementId, token) {
    field = browser.menus.getTargetElement(targetElementId);
    if (!field?.isConnected) { destroy(false); return; }
    host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    const root = host.attachShadow({ mode: 'closed' });
    frame = document.createElement('iframe');
    frame.src = `${browser.runtime.getURL('popup/bubble.html')}#${token}`;
    root.append(frame);
    important(host, { ...LOCKED_STYLE, visibility: 'hidden' });
    important(frame, {
      display: 'block', margin: '0', padding: '0', border: '0', 'border-radius': '8px', 'box-shadow': SHADOW,
      width: '0', height: '0', background: 'transparent',
    });
    const parent = container(field);
    parent.append(host);
    observer.observe(parent, { childList: true });
    observer.observe(host, { attributes: true });
    // The list's own toggle, which does not leave a shadow tree of the page the list may be in.
    host.addEventListener('toggle', onOwnToggle);
    if (!show()) { destroy(false); return; }
    let frameId = null;
    try { frameId = browser.runtime.getFrameId(frame); } catch { /* No frame: the check below fails. */ }
    if (!Number.isSafeInteger(frameId) || frameId <= 0) { destroy(false); return; }
    port.postMessage({ type: 'frame', frameId });
    follow();
  }

  // Where the frame is now, which the page could still change without moving the field: a change of its left, top or
  // width counts as a move, as rows may then be under the pointer; a list that only grows or shrinks below them
  // leaves them where they are.
  function measure() {
    const box = frame.getBoundingClientRect();
    const moved = !framed || ['left', 'top', 'width'].some((key) => Math.abs(framed[key] - box[key]) >= 0.5);
    if (moved) placedAt = Date.now();
    framed = box;
  }

  // Puts the list under the field, or above it when there is more room there. Returns false when the field is gone or
  // out of sight, the frame has no room for a list, or the page changed the list.
  function place() {
    if (!host) return false;
    const rect = field.isConnected && field.getClientRects().length ? field.getBoundingClientRect() : null;
    const below = rect ? innerHeight - rect.bottom - GAP - MARGIN : 0;
    const above = rect ? rect.top - GAP - MARGIN : 0;
    if (!rect || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth
      || Math.max(below, above) < MIN_ROOM) {
      destroy(false);
      return false;
    }
    const width = Math.max(0, Math.min(Math.max(rect.width, MIN_WIDTH), MAX_WIDTH, innerWidth - 2 * MARGIN));
    const left = Math.max(MARGIN, Math.min(rect.left, innerWidth - MARGIN - width));
    const downward = below >= height || below >= above;
    const tall = Math.min(height, downward ? below : above);
    const top = downward ? rect.bottom + GAP : rect.top - GAP - tall;
    const next = { left, top, width, height: tall };
    if (!placed || ['left', 'top', 'width', 'height'].some((key) => Math.abs(placed[key] - next[key]) >= 0.5)) {
      placed = next;
      if (!important(host, { left: `${left}px`, top: `${top}px` })) return false;
      if (!important(frame, { width: `${width}px`, height: `${tall}px` })) return false;
    }
    measure();
    return true;
  }

  // The list follows the field at every frame while it shows: the page may scroll, or move the field otherwise.
  function follow() {
    frameTask = requestAnimationFrame(follow);
    place();
  }

  function resize(next) {
    height = next;
    if (!place() || shown) return;
    shown = true;
    placedAt = Date.now();
    if (!important(host, { visibility: 'visible' })) return;
    frame.focus({ preventScroll: true });
    port.postMessage({ type: 'shown' });
  }

  // Another element of the page entered the top layer, where it would cover the list: the list goes back on top.
  // Hiding it gives the keyboard back to the field, so the list takes it again if it had it.
  function raise() {
    if (!host.matches(':popover-open')) return;
    const focused = host.getRootNode().activeElement === host;
    try { host.hidePopover(); } catch { /* The page removed it; show() fails. */ }
    if (!show()) { destroy(false); return; }
    placedAt = Date.now();
    if (focused) frame.focus({ preventScroll: true });
  }

  // Whether the click on the list at time at, x and y in the list page, could have been meant: 'ok'; 'early' when the
  // list appeared or moved less than SETTLE_MS before; anything else when the list was not there to be seen.
  function check({ at, x, y }) {
    if (!shown || !host?.isConnected || !host.matches(':popover-open') || !field.isConnected) return 'gone';
    measure();
    if (!Number.isFinite(at) || at < placedAt + SETTLE_MS) return 'early';
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > framed.width || y > framed.height) {
      return 'outside';
    }
    // The page's rules can still give the host a ::before or ::after, which would paint over the frame.
    const painted = (pseudo) => !['none', 'normal'].includes(getComputedStyle(host, pseudo).content);
    if (painted('::before') || painted('::after')) return 'covered';
    // The element at the click point must be the list: a part of the page drawn over it is not. It is looked for in
    // the list's own tree, which may be a shadow tree of the page.
    return host.getRootNode().elementFromPoint(framed.left + x, framed.top + y) === host ? 'ok' : 'covered';
  }

  const observer = new MutationObserver((records) => { if (tampered(records)) destroy(false); });

  function onPointer(event) {
    if (event.isTrusted && !event.composedPath().includes(host)) destroy(false);
  }

  function onKey(event) {
    if (!event.isTrusted || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    destroy(true);
  }

  // The page closed the list.
  function onOwnToggle() {
    if (host && !host.matches(':popover-open')) destroy(false);
  }

  // The page put something of its own in the top layer.
  function onToggle(event) {
    if (host && event.target !== host && event.target.matches?.(':popover-open, :modal')) raise();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') destroy(false);
  }

  // The list or the page lost the keyboard: the list goes when it went out of the page, which counts the list's frame
  // as its own; a click in the page closes it already.
  function checkFocus() {
    setTimeout(() => { if (!document.hasFocus()) destroy(false); }, FOCUS_MS);
  }

  function onBlur(event) {
    if (event.isTrusted && event.target === window) checkFocus();
  }

  // Removes the list; closing the port tells the extension, when the list goes because of this page.
  function destroy(refocus) {
    if (destroyed) return;
    destroyed = true;
    clearInterval(keepAlive);
    if (frameTask) cancelAnimationFrame(frameTask);
    observer.disconnect();
    removeEventListener('pointerdown', onPointer, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('toggle', onToggle, true);
    removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    host?.remove();
    host = frame = null;
    if (refocus && field?.isConnected) field.focus({ preventScroll: true });
    try { port.disconnect(); } catch { /* Already closed by the extension. */ }
    if (globalThis[KEY]?.destroy === destroy) delete globalThis[KEY];
  }

  port.onMessage.addListener((message) => {
    if (destroyed || !message || typeof message !== 'object') return;
    if (message.type === 'open' && !host && typeof message.token === 'string') {
      open(message.targetElementId, message.token);
    } else if (message.type === 'size' && host && Number.isFinite(message.height) && message.height >= 0) {
      resize(message.height);
    } else if (message.type === 'check') {
      port.postMessage({ type: 'checked', result: check(message) });
    } else if (message.type === 'blur') {
      checkFocus();
    } else if (message.type === 'close') {
      destroy(message.refocus === true);
    }
  });
  port.onDisconnect.addListener(() => destroy(false));
  addEventListener('pointerdown', onPointer, true);
  addEventListener('keydown', onKey, true);
  addEventListener('toggle', onToggle, true);
  addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  globalThis[KEY] = { destroy };
})();
