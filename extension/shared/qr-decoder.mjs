// QR codes are decoded locally: no image URLs, uploads or remote decoder services.
export const UNREADABLE_IMAGE = 'Could not read the image. Try a PNG or JPEG screenshot.';
const unreadable = () => new Error(UNREADABLE_IMAGE);
// Longest side, in pixels, at which a whole image or screen capture is decoded.
export const FULL_SIDE = 1800;

export const wholeRect = (bitmap) => ({ x: 0, y: 0, width: bitmap.width, height: bitmap.height });

// The pixels of a bitmap region, drawn on white and scaled down to fit maxSide.
export function imageData(bitmap, rect, maxSide) {
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, maxSide / Math.max(rect.width, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

// jsQR can take seconds, so it runs in a worker that an abort or close() stops at once. The worker wipes the
// pixels it is sent; each result is { data, location } or null.
export function createQrDecoder(signal) {
  const worker = new Worker(new URL('./qr-worker.mjs', import.meta.url), { type: 'module' });
  let pending = null;
  let failure = null;
  function settle(outcome, value) {
    const current = pending;
    pending = null;
    current?.[outcome](value);
  }
  function fail(error) {
    failure ??= error;
    close();
    settle('reject', error);
  }
  function close() {
    worker.terminate();
    signal?.removeEventListener('abort', abort);
  }
  const abort = () => fail(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = (event) => settle('resolve', event.data);
  worker.onerror = (event) => {
    event.preventDefault();
    fail(unreadable());
  };
  worker.onmessageerror = () => fail(unreadable());
  return {
    decode(pixels) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (failure) return Promise.reject(failure);
      if (pending) return Promise.reject(new Error('The QR decoder is busy.'));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage(pixels, [pixels.data.buffer]);
      });
    },
    close,
  };
}
