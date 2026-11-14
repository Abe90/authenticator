import { brandOf } from '../../core/brands.mjs';
import { migrationUris } from '../../core/migration.mjs';
import { encodeQr } from '../../core/qr-encode.mjs';
import { siteImage } from '../../core/site-icons.mjs';
import { t } from '../../shared/i18n.mjs';
import { createAccountIcon } from './account-icon.mjs';
import { element, message } from './dom.mjs';
import { onSubmit } from './forms.mjs';

// The light modules around a QR code, and the pixels of a module in the image that is copied or saved.
const QUIET_ZONE = 4;
const MODULE_PIXELS = 8;

// Export codes, from Settings, once the password was checked: the accounts to choose, as in the list of an import,
// then their QR code, which Authenticator and Google Authenticator read (core/migration.mjs). Many accounts make
// several QR codes, shown one at a time. A click on the QR code enlarges it to the width of the popup, for a phone
// to read it, and another click brings it back. The QR code is not encrypted: nothing of it is kept, and reset() wipes it.
export function createExportQr({ vault, views, onCancel }) {
  const form = element('#export-form');
  const list = element('#export-accounts');
  const all = element('#export-all');
  const submit = element('#export-submit');
  const error = element('#export-error');
  const canvas = element('#export-qr');
  const zoom = element('#export-zoom');
  const zoomIcon = element('.icon', zoom);
  const pager = element('#export-pager');
  const page = element('#export-page');
  const previous = element('#export-previous');
  const next = element('#export-next');
  const copy = element('#export-copy');
  const copyIcon = element('.icon', copy);
  const qrError = element('#export-qr-error');
  let choices = [];
  let uris = [];
  let index = 0;

  const selected = () => choices.filter(({ checkbox }) => checkbox.checked).map(({ account }) => account);

  function updateSelection() {
    const count = selected().length;
    submit.disabled = !count;
    all.checked = count > 0 && count === choices.length;
    all.indeterminate = count > 0 && count < choices.length;
  }

  function enlarge(large) {
    zoom.setAttribute('aria-pressed', String(large));
    zoomIcon.className = large ? 'icon icon-zoom-out' : 'icon icon-zoom-in';
  }

  function wipe() {
    enlarge(false);
    uris = [];
    index = 0;
    canvas.width = canvas.height = 1;
    pager.hidden = true;
    page.textContent = '';
    message(qrError);
  }

  function reset() {
    wipe();
    choices = [];
    list.replaceChildren();
    message(error);
  }

  // Fills the list with every account, all chosen.
  async function load() {
    reset();
    let accounts = [];
    let icons = {};
    try {
      accounts = await vault.read();
      icons = await vault.siteIcons().catch(() => ({}));
    } catch { message(error, t('exportQrFailed')); }
    choices = accounts.map((account) => {
      const label = document.createElement('label');
      label.className = 'migration-account';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      const text = document.createElement('span');
      text.textContent = account.name;
      label.append(checkbox, createAccountIcon(account.name, brandOf(account), siteImage(account, icons)), text);
      list.append(label);
      checkbox.addEventListener('change', updateSelection);
      return { checkbox, account };
    });
    all.closest('label').hidden = choices.length < 2;
    if (!choices.length && error.hidden) message(error, t('noCodes'));
    updateSelection();
  }

  function draw() {
    const { size, modules } = encodeQr(uris[index]);
    canvas.width = canvas.height = (size + QUIET_ZONE * 2) * MODULE_PIXELS;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    const at = (module) => (module + QUIET_ZONE) * MODULE_PIXELS;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y * size + x]) context.fillRect(at(x), at(y), MODULE_PIXELS, MODULE_PIXELS);
      }
    }
    pager.hidden = uris.length < 2;
    page.textContent = uris.length > 1 ? t('exportQrPage', index + 1, uris.length) : '';
    previous.disabled = index === 0;
    next.disabled = index === uris.length - 1;
    message(qrError);
  }

  function turn(step) {
    if (!uris[index + step]) return;
    index += step;
    draw();
    // A button that went off at an end leaves the keyboard on the other.
    if (document.activeElement === document.body || document.activeElement?.disabled) {
      (step > 0 ? previous : next).focus();
    }
  }

  onSubmit(form, async () => {
    if (views.changing || !selected().length) return;
    try {
      uris = migrationUris(selected());
      index = 0;
      draw();
    } catch {
      wipe();
      message(error, t('exportQrFailed'));
      return;
    }
    message(error);
    await views.navigate('export-qr');
  });
  all.addEventListener('change', () => {
    for (const { checkbox } of choices) checkbox.checked = all.checked;
    updateSelection();
  });
  element('#export-cancel').addEventListener('click', () => onCancel());
  zoom.addEventListener('click', () => enlarge(zoom.getAttribute('aria-pressed') !== 'true'));
  previous.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));
  // Copy puts the image of the QR code shown in the clipboard, and shows a tick for a moment.
  copy.addEventListener('click', async () => {
    if (!uris.length) return;
    try {
      const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      message(qrError, t('clipboardFailed'));
      return;
    }
    message(qrError);
    copyIcon.className = 'icon icon-check';
    setTimeout(() => { copyIcon.className = 'icon icon-copy'; }, 1500);
  });
  // Save downloads it as a file, from a data: address, which is still there if the popup closes meanwhile.
  element('#export-save').addEventListener('click', () => {
    if (!uris.length) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = uris.length > 1 ? `authenticator-qr-${index + 1}.png` : 'authenticator-qr.png';
    link.click();
  });

  return {
    load,
    reset,
    // From the QR code back to the accounts: the QR code is wiped, the choice stays.
    async back() {
      await views.navigate('export');
      if (views.current === 'export') wipe();
    },
  };
}
