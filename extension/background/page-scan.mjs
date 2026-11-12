import { parseQrAccount } from '../core/migration.mjs';
import { SCAN_TARGET_KEY } from '../core/storage-keys.mjs';
import { UserError } from '../core/user-error.mjs';
import { FULL_SIDE, createQrDecoder, imageData, wholeRect } from '../shared/qr-decoder.mjs';
import { cornersRect, cropRect, isOtpPayload, overlaps } from './scan-geometry.mjs';

// Only rectangles cross into the page: the capture, the decoded text and the secret stay in the extension.

const OVERLAY_FILE = '/content/qr-overlay.js';
export const PORT_NAME = 'qr-scan';
const MAX_ITEMS = 40;
const CONNECT_TIMEOUT_MS = 5000;
// Longest side, in pixels, at which the crop around one page element is decoded.
const CROP_SIDE = 1024;

async function loadCapture(api, windowId) {
  const url = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
  return createImageBitmap(await (await fetch(url)).blob());
}

const DEFAULTS = { loadCapture, imageData, createDecoder: createQrDecoder, parse: parseQrAccount };

async function findTarget(api) {
  const { [SCAN_TARGET_KEY]: target } = await api.storage.session.get(SCAN_TARGET_KEY);
  if (!Number.isSafeInteger(target?.tabId) || !Number.isSafeInteger(target?.windowId)) {
    throw new UserError('scanGrant');
  }
  let tab;
  try { tab = await api.tabs.get(target.tabId); } catch { throw new UserError('scanGrant'); }
  if (!tab.active || tab.windowId !== target.windowId) throw new UserError('scanGrant');
  return { tabId: target.tabId, windowId: target.windowId };
}

const isSize = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// The page is not trusted: anything malformed ends the scan.
export function readCandidates(message) {
  const { viewport, items } = message;
  if (!viewport || !isSize(viewport.innerWidth) || !viewport.innerWidth || !isSize(viewport.innerHeight)) return null;
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return null;
  const rects = [];
  for (const item of items) {
    if (!item || !['x', 'y', 'width', 'height'].every((key) => isSize(item[key]))) return null;
    rects.push({ x: item.x, y: item.y, width: item.width, height: item.height });
  }
  return { innerWidth: viewport.innerWidth, items: rects };
}

// Resolves to the picked record, or null when cancelled; rejects with a UserError for the user. onInput(time) runs for
// the user's input on the page.
export async function scanPage({ api = browser, signal, onInput, ...overrides } = {}) {
  const deps = { ...DEFAULTS, ...overrides };
  if (signal?.aborted) return null;
  const target = await findTarget(api);
  if (signal?.aborted) return null;

  const internal = new AbortController();
  const decoder = deps.createDecoder(internal.signal);
  const payloads = new Map();
  let port = null;
  let regionCount = 0;
  let revision = 0;
  let queue = Promise.resolve();
  let settle;
  const outcome = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const active = () => settle !== null;
  function finish(value, error) {
    if (!settle) return;
    const current = settle;
    settle = null;
    if (error) current.reject(error);
    else current.resolve(value);
    internal.abort();
  }
  const cancel = () => finish(null);
  signal?.addEventListener('abort', cancel, { once: true });

  async function withCapture(use) {
    let bitmap;
    try { bitmap = await deps.loadCapture(api, target.windowId); } catch { throw new UserError('scanGrant'); }
    try { return await use(bitmap); } finally { bitmap.close(); }
  }

  async function decode(bitmap, rect, maxSide) {
    const pixels = deps.imageData(bitmap, rect, maxSide);
    const width = pixels.width;
    const code = await decoder.decode(pixels);
    return code && isOtpPayload(code.data) ? { ...code, width } : null;
  }

  // Returns the regions with their payloads, or null when a newer pass or the end of the scan made it stale.
  async function findRegions(bitmap, innerWidth, items, stale) {
    const bounds = wholeRect(bitmap);
    const scale = bitmap.width / innerWidth;
    const regions = [];
    for (const item of items) {
      const crop = cropRect(item, scale, bounds);
      if (!crop) continue;
      const code = await decode(bitmap, crop, CROP_SIDE);
      if (stale()) return null;
      if (!code) continue;
      // The hole frames the code itself, not the whole element that shows it.
      const offset = { x: crop.x / scale, y: crop.y / scale };
      const rect = cornersRect(code.location, (code.width / crop.width) * scale, offset);
      // Nested elements, such as a picture and its img, show the same code.
      if (!regions.some((region) => region.data === code.data && overlaps(region, rect))) {
        regions.push({ ...rect, data: code.data });
      }
    }
    // Codes drawn with CSS or inside cross-origin frames are invisible to the element search. Reading the whole
    // capture is the slowest step, so it is skipped once an element shows a code.
    if (regions.length) return regions;
    const code = await decode(bitmap, bounds, FULL_SIDE);
    if (stale()) return null;
    if (code) regions.push({ ...cornersRect(code.location, code.width / innerWidth), data: code.data });
    return regions;
  }

  async function show(pass, candidates) {
    const stale = () => pass !== revision || !active();
    if (stale()) return;
    const regions = await withCapture((bitmap) => findRegions(bitmap, candidates.innerWidth, candidates.items, stale));
    if (regions === null) return;
    payloads.clear();
    const geometry = regions.map(({ data, ...rect }) => {
      const id = `r${++regionCount}`;
      payloads.set(id, data);
      return { id, ...rect };
    });
    // With no code yet, the overlay still shows, asking to scroll until a whole code is visible.
    port?.postMessage({ type: 'show', regions: geometry });
  }

  function onMessage(message) {
    if (!active() || !message || typeof message !== 'object') return;
    if (message.type === 'candidates') {
      const candidates = readCandidates(message);
      if (!candidates) { cancel(); return; }
      const pass = ++revision;
      queue = queue.then(() => show(pass, candidates)).catch((error) => finish(null, error));
    } else if (message.type === 'pick') {
      if (typeof message.id !== 'string' || !payloads.has(message.id)) return;
      let record;
      try { record = deps.parse(payloads.get(message.id)); } catch (error) { finish(null, error); return; }
      finish(record);
    } else if (message.type === 'cancel') cancel();
    // The user's input on the page while the overlay shows, for the auto-lock.
    else if (message.type === 'input') onInput?.(message.at);
    // 'keepalive' messages only keep the background script awake while the user picks.
  }

  function onConnect(candidate) {
    const { sender } = candidate;
    if (candidate.name !== PORT_NAME || port || !active() || sender?.id !== api.runtime.id
      || sender?.tab?.id !== target.tabId || sender?.frameId !== 0) {
      candidate.disconnect();
      return;
    }
    port = candidate;
    port.onMessage.addListener(onMessage);
    // The page navigated or closed, or the overlay was removed.
    port.onDisconnect.addListener(() => { port = null; cancel(); });
  }

  function onActivated({ tabId, windowId }) {
    if (windowId === target.windowId && tabId !== target.tabId) cancel();
  }

  // Pages that cannot be scripted may still be captured: a single code found there fills the form directly.
  async function scanWithoutPage() {
    const code = await withCapture((bitmap) => decode(bitmap, wholeRect(bitmap), FULL_SIDE));
    if (!active()) return null;
    if (!code) throw new UserError('scanUnscannable');
    return deps.parse(code.data);
  }

  api.runtime.onConnect.addListener(onConnect);
  api.tabs.onActivated.addListener(onActivated);
  let timer;
  try {
    let injected = true;
    try {
      await api.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [0] }, files: [OVERLAY_FILE] });
    } catch { injected = false; }
    if (!active()) return null;
    if (!injected) {
      try { return await scanWithoutPage(); } catch (error) {
        if (!active()) return null;
        throw error;
      }
    }
    timer = setTimeout(() => { if (!port) finish(null, new UserError('scanFailed')); }, CONNECT_TIMEOUT_MS);
    return await outcome;
  } finally {
    clearTimeout(timer);
    finish(null);
    decoder.close();
    payloads.clear();
    signal?.removeEventListener('abort', cancel);
    api.runtime.onConnect.removeListener(onConnect);
    api.tabs.onActivated.removeListener(onActivated);
    if (port) {
      try { port.disconnect(); } catch { /* Already gone with the page. */ }
      port = null;
    }
  }
}
