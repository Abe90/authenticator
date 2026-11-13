import { decodeBase32 } from '../../core/base32.mjs';
import { isShortManualKey } from '../../core/totp.mjs';
import { cleanName } from '../../core/limits.mjs';
import { DuplicateAccountError, duplicateReasons } from '../../core/duplicates.mjs';
import { t } from '../../shared/i18n.mjs';
import { NAME_REQUIRED, changeHint, saveFailure, storedAccounts } from './account-input.mjs';
import { element, message } from './dom.mjs';
import { createMigrationPreview } from './migration-preview.mjs';
import { createQrPicker } from './qr-picker.mjs';
import { createSiteList } from './site-list.mjs';

// proposedSite resolves to the site the form proposes for a key typed in or read from an image, or to null.
export function createAddForm({ vault, active, blocked, proposedSite, onSaved, onCancel }) {
  const form = element('#account-form');
  const name = element('#account-name');
  const secret = element('#account-secret');
  const type = element('#key-type');
  const fields = element('#manual-account-fields');
  const save = element('#account-save');
  const qrButton = element('#import-qr');
  const error = element('#form-error');
  const sites = createSiteList(element('#account-sites'));
  // Bumped whenever the site list is filled, so that a proposal arriving late never replaces a newer list.
  let proposal = 0;
  let importedCounter = '0';
  // The key read from a single-account QR code; the issuer chose it, so its length is not checked.
  let importedSecret = null;
  let saving = false;
  let revision = 0;
  const preview = createMigrationPreview({
    preview: element('#migration-preview'),
    accounts: element('#migration-accounts'),
    title: element('#detected-codes-title'),
    summary: element('#migration-summary'),
    onSelection: (count) => { save.disabled = !count; },
  });

  function updateHint() {
    element('#form-hint').textContent = changeHint(type.value);
  }

  function showManual() {
    preview.clear();
    fields.hidden = false;
    name.disabled = secret.disabled = type.disabled = false;
    save.disabled = false;
    importedCounter = '0';
    importedSecret = null;
    updateHint();
  }

  // The site list, empty, then with the proposed site.
  function propose() {
    const current = ++proposal;
    sites.show();
    proposedSite.then((host) => { if (current === proposal && host) sites.show([host]); });
  }

  // One account fills the form; an export shows its list, where accounts already stored cannot be selected. host,
  // when given, is the site of a Scan page result, or null, and replaces the list; an export takes no site.
  async function applyRecord(record, host) {
    let reasons = [];
    if (record.kind === 'migration') {
      const current = revision;
      reasons = duplicateReasons(record.accounts, await storedAccounts(vault));
      if (current !== revision) return;
    }
    showManual();
    if (record.kind === 'migration') {
      name.value = secret.value = '';
      fields.hidden = true;
      name.disabled = secret.disabled = type.disabled = true;
      preview.show(record, reasons);
      if (!save.disabled) save.focus();
    } else {
      name.value = record.name;
      secret.value = record.secret;
      type.value = record.type;
      importedCounter = record.counter;
      importedSecret = record.secret;
      if (host !== undefined) {
        proposal++;
        sites.show(host ? [host] : []);
      }
      updateHint();
      name.focus();
    }
  }

  const picker = createQrPicker({
    active,
    blocked: () => saving || blocked(),
    onError: (text) => message(error, text),
    onBusy: (busy) => {
      save.disabled = busy || (preview.visible && !preview.selected().length);
    },
    // An image keeps the site list as it is.
    onRead: (record) => applyRecord(record),
  });

  // A Scan page result: a record or an error message. It never replaces a form being saved or an image being read.
  function applyScanResult(result) {
    if (saving || picker.busy || !active()) return;
    message(error);
    if (result.record) applyRecord(result.record, result.host ?? null);
    else if (result.error) message(error, result.error);
  }

  function reset() {
    revision++;
    form.reset();
    showManual();
    propose();
    picker.reset();
    message(error);
    save.textContent = t('add');
  }

  function manualRecord() {
    const label = cleanName(name.value);
    const key = secret.value.toUpperCase().replace(/\s/g, '');
    if (!label) {
      message(error, NAME_REQUIRED);
      name.focus();
      return null;
    }
    try { decodeBase32(key); }
    catch {
      message(error, t('invalidKey'));
      secret.focus();
      return null;
    }
    if (key !== importedSecret && isShortManualKey(key)) {
      message(error, t('keyTooShort'));
      secret.focus();
      return null;
    }
    const siteEntries = sites.readSites();
    if (!siteEntries) return null;
    return {
      name: label, secret: key, type: type.value, counter: type.value === 'hotp' ? importedCounter : '0',
      sites: siteEntries,
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || picker.busy || blocked() || !active()) return;
    const records = preview.visible ? preview.selected() : [manualRecord()].filter(Boolean);
    if (!records.length) return;
    const current = revision;
    saving = true;
    save.disabled = qrButton.disabled = true;
    save.textContent = t('saving');
    message(error);
    try {
      const saved = await vault.addMany(records);
      if (current !== revision) return;
      saving = false;
      reset();
      await onSaved(saved);
    } catch (failure) {
      if (current !== revision) return;
      message(error, saveFailure(failure));
      if (failure instanceof DuplicateAccountError && !preview.visible) secret.focus();
    } finally {
      saving = false;
      if (current === revision) {
        save.disabled = preview.visible && !preview.selected().length;
        qrButton.disabled = false;
        save.textContent = t('add');
      }
    }
  }

  type.addEventListener('change', () => { importedCounter = '0'; updateHint(); });
  secret.addEventListener('input', () => { importedCounter = '0'; });
  form.addEventListener('submit', submit);
  element('#cancel').addEventListener('click', () => { if (!saving) onCancel(); });
  return { reset, applyScanResult, get busy() { return saving; } };
}
