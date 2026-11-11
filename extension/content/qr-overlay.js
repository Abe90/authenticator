// Injected into the scanned page to report where images are and draw the picker. It never sees the capture, the
// decoded text or any secret, and acts on trusted events only.
(() => {
  const KEY = Symbol.for('authenticator.qrScan');
  globalThis[KEY]?.destroy();

  const MEDIA = new Set(['img', 'picture', 'canvas', 'svg', 'object', 'iframe', 'embed', 'video']);
  const MAX_ITEMS = 40;
  const PADDING = 6;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The primary violet of the popup's light theme (--button in popup.css), in the dark theme too.
  const PRIMARY = '#7543e3';
  const port = browser.runtime.connect({ name: 'qr-scan' });
  let regions = [];
  let hovered = -1;
  let host = null;
  let canvas = null;
  let hint = null;
  let live = null;
  let debounce = 0;
  let destroyed = false;
  // Firefox stops an idle background script after 30 seconds, even with this port open; a message resets that.
  const keepAlive = setInterval(() => {
    try { port.postMessage({ type: 'keepalive' }); } catch { /* The port closed; destroy() follows. */ }
  }, 10_000);
  // Regions are measured at the scroll position of the last report; the holes follow the document scroll.
  let reported = { x: scrollX, y: scrollY };
  let origin = reported;

  function important(element, properties) {
    for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value, 'important');
  }

  // Visible, roughly square elements that can show an image, largest first, as viewport rectangles.
  function candidates() {
    const width = innerWidth, height = innerHeight;
    const items = [];
    for (const element of document.querySelectorAll('*')) {
      if (element === host) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      const ratio = rect.width / rect.height;
      if (ratio < 0.75 || ratio > 1.33) continue;
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      const right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
      if (right <= left || bottom <= top) continue;
      const style = getComputedStyle(element);
      if (!MEDIA.has(element.localName) && style.backgroundImage === 'none') continue;
      if (style.visibility === 'hidden' || Number(style.opacity) <= 0.1) continue;
      items.push({ x: left, y: top, width: right - left, height: bottom - top });
    }
    items.sort((a, b) => b.width * b.height - a.width * a.height);
    return items.slice(0, MAX_ITEMS);
  }

  // The capture includes the overlay: codes in a hole are clear and dimmed ones still decode, so it never hides.
  function report() {
    if (destroyed) return;
    reported = { x: scrollX, y: scrollY };
    port.postMessage({ type: 'candidates', viewport: { innerWidth, innerHeight }, items: candidates() });
  }

  function placed() {
    const dx = scrollX - origin.x, dy = scrollY - origin.y;
    return regions.map((region) => ({ ...region, x: region.x - dx, y: region.y - dy }));
  }

  function build() {
    host = document.createElement('authenticator-qr-scan');
    important(host, {
      all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', display: 'block',
      cursor: 'default', 'pointer-events': 'auto',
    });
    const root = host.attachShadow({ mode: 'closed' });
    canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'QR codes on this page');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', outline: 'none' });
    hint = document.createElement('div');
    Object.assign(hint.style, {
      position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px',
      borderRadius: '18px', background: '#202124', color: '#fff', font: '500 14px/20px system-ui, sans-serif',
      whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 2px 6px rgba(0, 0, 0, .3)',
    });
    live = document.createElement('div');
    live.setAttribute('aria-live', 'polite');
    Object.assign(live.style, {
      position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)',
    });
    root.append(canvas, hint, live);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    document.documentElement.append(host);
    if (!reducedMotion) host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
  }

  function regionAt(x, y) {
    return placed().findIndex((region) => x >= region.x - PADDING && x <= region.x + region.width + PADDING
      && y >= region.y - PADDING && y <= region.y + region.height + PADDING);
  }

  function draw() {
    const ratio = devicePixelRatio;
    const width = host.clientWidth, height = host.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.fillStyle = 'rgba(32, 33, 36, .62)';
    context.fillRect(0, 0, width, height);
    placed().forEach((region, index) => {
      const shape = () => {
        context.beginPath();
        context.roundRect(
          region.x - PADDING, region.y - PADDING, region.width + PADDING * 2, region.height + PADDING * 2, 8);
      };
      // An opaque fill clears the dimming completely inside the hole.
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = '#000';
      shape();
      context.fill();
      context.globalCompositeOperation = 'source-over';
      shape();
      // Primary in every state; the code under the pointer or picked with Tab has the thicker border.
      context.lineWidth = index === hovered ? 4 : 2;
      context.strokeStyle = PRIMARY;
      context.stroke();
    });
    canvas.style.cursor = hovered >= 0 ? 'pointer' : 'default';
  }

  function show(next) {
    regions = next;
    origin = reported;
    hovered = regions.length === 1 ? 0 : -1;
    if (!host) build();
    important(host, { display: 'block' });
    hint.textContent = regions.length
      ? 'Click a QR code to import it · Esc to cancel'
      : 'No whole QR code visible · Scroll until it shows or press Esc';
    live.textContent = regions.length === 1
      ? '1 QR code found. Click it or press Enter to import it, or press Escape to cancel.'
      : `${regions.length} QR codes found. Click one to import it, or press Escape to cancel.`;
    draw();
    canvas.focus({ preventScroll: true });
  }

  function onMove(event) {
    if (!event.isTrusted) return;
    const index = regionAt(event.clientX, event.clientY);
    if (index !== hovered) { hovered = index; draw(); }
  }

  function onClick(event) {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    const index = regionAt(event.clientX, event.clientY);
    if (index >= 0) port.postMessage({ type: 'pick', id: regions[index].id });
    else cancel();
  }

  function onKey(event) {
    if (!event.isTrusted || destroyed) return;
    if (event.key === 'Escape') cancel();
    else if (event.key === 'Tab' && host && regions.length) {
      const step = event.shiftKey ? -1 : 1;
      hovered = hovered < 0 ? (step > 0 ? 0 : regions.length - 1) : (hovered + step + regions.length) % regions.length;
      draw();
    } else if (event.key === 'Enter' && host && hovered >= 0) {
      port.postMessage({ type: 'pick', id: regions[hovered].id });
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // The holes follow the document scroll. Other scrolling or a resize moves codes unpredictably, so the holes
  // close until the next look: when scrolling ends, or 200 ms after the page settles.
  function onLayoutChange(event) {
    if (destroyed) return;
    if (event.type === 'resize' || event.target !== document) { regions = []; hovered = -1; }
    if (host) draw();
    clearTimeout(debounce);
    debounce = setTimeout(report, 200);
  }

  function onScrollEnd() {
    if (destroyed) return;
    clearTimeout(debounce);
    report();
  }

  const observer = new MutationObserver(() => { if (host && !host.isConnected) cancel(); });

  function cancel() {
    if (destroyed) return;
    port.postMessage({ type: 'cancel' });
    destroy();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(debounce);
    clearInterval(keepAlive);
    observer.disconnect();
    removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onLayoutChange, true);
    removeEventListener('scrollend', onScrollEnd, true);
    removeEventListener('resize', onLayoutChange);
    host?.remove();
    host = canvas = hint = live = null;
    regions = [];
    try { port.disconnect(); } catch { /* Already closed by the extension. */ }
    if (globalThis[KEY]?.destroy === destroy) delete globalThis[KEY];
  }

  const isRect = (value) => ['x', 'y', 'width', 'height']
    .every((key) => Number.isFinite(value?.[key]) && value[key] >= 0);
  port.onMessage.addListener((message) => {
    if (destroyed || message?.type !== 'show' || !Array.isArray(message.regions)) return;
    const next = message.regions.filter((region) => typeof region.id === 'string' && isRect(region))
      .map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
    show(next);
  });
  port.onDisconnect.addListener(destroy);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', onLayoutChange, true);
  addEventListener('scrollend', onScrollEnd, true);
  addEventListener('resize', onLayoutChange);
  observer.observe(document.documentElement, { childList: true });
  globalThis[KEY] = { destroy };
  report();
})();
