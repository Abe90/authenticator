import { duplicateReasons, findDuplicate } from '../../core/duplicates.mjs';
import { cleanName } from '../../core/limits.mjs';
import { t } from '../../shared/i18n.mjs';
import { NAME_REQUIRED, saveFailure, storedAccounts } from './account-input.mjs';
import { element, message } from './dom.mjs';
import { createMigrationPreview } from './migration-preview.mjs';
import { createSiteList } from './site-list.mjs';

// The Scanned code page confirms a code picked with Scan page: one account with an editable name and its sites, the
// scanned page's to begin with, or an export's list, which takes no site. A single code already stored gets the
// notice page instead. An unsaved code is lost on leaving.
export function createScanConfirm({ vault, notice, active, onSaved, onCancel }) {
  const form = element('#scan-confirm');
  const single = element('#scan-single');
  const name = element('#scan-name');
  const kind = element('#scan-type');
  const save = element('#scan-save');
  const error = element('#scan-error');
  const sites = createSiteList(element('#scan-sites'));
  let record = null;
  let saving = false;
  let revision = 0;
  const preview = createMigrationPreview({
    preview: element('#scan-migration'),
    accounts: element('#scan-accounts'),
    title: element('#scan-accounts-title'),
    summary: element('#scan-summary'),
    onSelection: (count) => { save.disabled = saving || !count; },
  });
  const isExport = () => record?.kind === 'migration';

  // Fills the hidden page and resolves to its name, 'scan' or 'notice'; null when a newer call took over. host is the
  // scanned page's, or null.
  async function show(next, host = null) {
    const current = ++revision;
    const accounts = await storedAccounts(vault);
    if (current !== revision) return null;
    const existing = next.kind === 'migration' ? null : findDuplicate(accounts, next);
    if (existing) {
      notice.fill(t('codeAlreadyAdded'), t('alreadyAdded', existing.name), 'list');
      return 'notice';
    }
    record = next;
    message(error);
    save.disabled = false;
    save.textContent = t('add');
    // A hidden required field would stop the form from being submitted; a disabled one is not checked.
    name.disabled = isExport();
    if (isExport()) {
      single.hidden = true;
      preview.show(next, duplicateReasons(next.accounts, accounts));
      return 'scan';
    }
    preview.clear();
    single.hidden = false;
    name.value = next.name;
    sites.show(host ? [host] : []);
    kind.textContent = next.type === 'hotp' ? t('scanTypeHotp') : t('scanTypeTotp');
    return 'scan';
  }

  function clear() {
    revision++;
    record = null;
    name.value = '';
    sites.show();
    preview.clear();
    message(error);
  }

  // Focus on arriving at the Scanned code page.
  function focus() {
    (isExport() ? element('#scan-cancel') : name).focus({ preventScroll: true, focusVisible: false });
    if (!isExport()) name.select();
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !record || !active()) return;
    const label = cleanName(name.value);
    if (!isExport() && !label) {
      message(error, NAME_REQUIRED);
      name.focus();
      return;
    }
    const chosen = isExport() ? { kept: [], added: [] } : sites.read();
    if (!chosen) return;
    const siteEntries = [...chosen.kept, ...chosen.added].map((host) => ({ host }));
    const records = (isExport() ? preview.selected() : [{ ...record, name: label }])
      .map(({ name: accountName, secret, type, counter }) => ({
        name: accountName, secret, type, counter, sites: siteEntries,
      }));
    if (!records.length) return;
    const current = revision;
    saving = true;
    save.disabled = true;
    save.textContent = t('saving');
    message(error);
    try {
      const saved = await vault.addMany(records);
      if (current !== revision) return;
      // Saving is over: leaving the page must not be blocked by it.
      saving = false;
      clear();
      await onSaved(saved);
    } catch (failure) {
      if (current === revision) message(error, saveFailure(failure));
    } finally {
      saving = false;
      save.textContent = t('add');
      if (current === revision) save.disabled = isExport() && !preview.selected().length;
    }
  }

  // Back to the list without saving: the back arrow, Escape and Cancel.
  function cancel() {
    if (saving) return;
    clear();
    onCancel();
  }

  form.addEventListener('submit', submit);
  element('#scan-cancel').addEventListener('click', cancel);
  return { show, clear, focus, cancel, get busy() { return saving; } };
}
