import { parseQrAccount } from '../../core/migration.mjs';
import { UserError } from '../../core/user-error.mjs';
import { errorText, t } from '../../shared/i18n.mjs';
import { FULL_SIDE, createQrDecoder, imageData, unreadable, wholeRect } from '../../shared/qr-decoder.mjs';
import { element } from './dom.mjs';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

async function readQrImage(file, signal) {
  if (!TYPES.includes(file.type)) throw new UserError('imageType');
  if (file.size > 10 * 1024 * 1024) throw new UserError('imageTooBig');
  const pixels = await rasterize(file);
  signal?.throwIfAborted();
  const decoder = createQrDecoder(signal);
  let code;
  try { code = await decoder.decode(pixels); } finally { decoder.close(); }
  if (code === null) throw new UserError('qrNotFound');
  return parseQrAccount(code.data);
}

async function rasterize(file) {
  let bitmap;
  try {
    try { bitmap = await createImageBitmap(file); } catch { throw unreadable(); }
    if (bitmap.width * bitmap.height > 20_000_000) throw new UserError('imageTooLarge');
    return imageData(bitmap, wholeRect(bitmap), FULL_SIDE);
  } finally {
    bitmap?.close();
  }
}

export function createQrPicker({ active, blocked, onRead, onError, onBusy }) {
  const button = element('#import-qr');
  const input = element('#qr-file');
  let revision = 0;
  let busy = false;
  let controller = null;

  function reset() {
    revision++;
    controller?.abort();
    controller = null;
    busy = false;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    input.value = '';
    onBusy(false);
  }

  async function read(file) {
    if (!file || !active() || blocked() || busy) return;
    const current = ++revision;
    controller = new AbortController();
    const { signal } = controller;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    onError('');
    onBusy(true);
    try {
      const record = await readQrImage(file, signal);
      if (current === revision && active()) onRead(record);
    } catch (error) {
      if (current === revision && active()) onError(errorText(error, t('imageUnreadable')));
    } finally {
      if (current === revision) reset();
    }
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => read(input.files[0]));
  document.addEventListener('paste', (event) => {
    if (!active()) return;
    const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      read(image.getAsFile());
    }
  });
  return { reset, get busy() { return busy; } };
}
