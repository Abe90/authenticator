import { plural, t } from '../../shared/i18n.mjs';

// The account list of a Google export, in the Add code window or in the scan confirmation of the popup.
export function createMigrationPreview({ preview, accounts, title, summary, onSelection }) {
  let choices = [];

  function selected() {
    return choices.filter(({ checkbox, record }) => checkbox.checked && record).map(({ record }) => record);
  }

  function clear() {
    choices = [];
    accounts.replaceChildren();
    preview.hidden = true;
  }

  // reasons[i], when set, is why account i cannot be added (see duplicateReasons in core/duplicates.mjs); an account
  // the export damaged has its own error, as { key, values } for a message.
  function show(payload, reasons = []) {
    clear();
    const count = payload.accounts.length;
    title.textContent = plural('accountCount', count);
    summary.hidden = payload.batchSize <= 1;
    summary.textContent = payload.batchSize > 1 ? t('exportPart', payload.batchIndex + 1, payload.batchSize) : '';
    choices = payload.accounts.map((entry, index) => {
      const reason = reasons[index] ?? null;
      const record = reason ? null : entry.record;
      const label = document.createElement('label');
      label.className = 'migration-account';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(record);
      checkbox.disabled = !record;
      const text = document.createElement('span');
      text.textContent = entry.name;
      if (entry.error || reason) {
        const note = document.createElement('small');
        if (entry.error) note.textContent = t(entry.error.key, ...entry.error.values);
        else note.textContent = reason === 'repeated' ? t('listedTwiceInExport') : t('alreadyInList');
        note.classList.toggle('duplicate', Boolean(reason));
        text.append(note);
      }
      label.append(checkbox, text);
      accounts.append(label);
      checkbox.addEventListener('change', () => onSelection(selected().length));
      return { checkbox, record };
    });
    preview.hidden = false;
    onSelection(selected().length);
  }

  return { show, clear, selected, get visible() { return !preview.hidden; } };
}
