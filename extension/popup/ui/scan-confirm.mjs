import { DuplicateAccountError, duplicateReasons, findDuplicate } from '../../core/duplicates.mjs';
import { cleanName } from '../../core/limits.mjs';
import { NAME_REQUIRED, changeHint, saveFailure, storedAccounts } from './account-input.mjs';
import { element, message } from './dom.mjs';
import { createMigrationPreview } from './migration-preview.mjs';

// The Scanned code page confirms a code picked with Scan page: one account with an editable name, or an export's
// list. A single code already stored gets the notice page instead. An unsaved code is lost on leaving.
export function createScanConfirm({ vault, notice, active, onSaved, onCancel }) {
  const form = element('#scan-confirm');
  const single = element('#scan-single');
  const name = element('#scan-name');
  const kind = element('#scan-type');
  const save = element('#scan-save');
  const error = element('#scan-error');
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

  // Fills the hidden page and resolves to its name, 'scan' or 'notice'; null when a newer call took over.
  async function show(next) {
    const current = ++revision;
    const accounts = await storedAccounts(vault);
    if (current !== revision) return null;
    const existing = next.kind === 'migration' ? null : findDuplicate(accounts, next);
    if (existing) {
      notice.fill('Code already added',
        `${new DuplicateAccountError(existing.name).message} You don’t need to add it again.`, 'list');
      return 'notice';
    }
    record = next;
    message(error);
    save.disabled = false;
    save.textContent = 'Add';
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
    kind.textContent = `${next.type === 'hotp' ? 'Counter based' : 'Time based'}. ${changeHint(next.type)}`;
    return 'scan';
  }

  function clear() {
    revision++;
    record = null;
    name.value = '';
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
    const records = (isExport() ? preview.selected() : [{ ...record, name: label }])
      .map(({ name: accountName, secret, type, counter }) => ({ name: accountName, secret, type, counter }));
    if (!records.length) return;
    const current = revision;
    saving = true;
    save.disabled = true;
    save.textContent = 'Saving…';
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
      save.textContent = 'Add';
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
