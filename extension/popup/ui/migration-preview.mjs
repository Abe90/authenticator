import { plural } from './messages.mjs';

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

  // reasons[i], when set, says why account i cannot be added (see duplicateReasons in core/duplicates.mjs).
  function show(payload, reasons = []) {
    clear();
    const count = payload.accounts.length;
    title.textContent = plural(count, 'Account');
    summary.hidden = payload.batchSize <= 1;
    summary.textContent = payload.batchSize > 1
      ? `QR ${payload.batchIndex + 1} of ${payload.batchSize}: this image contains only part of the export. `
        + 'Import the other images separately.'
      : '';
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
        note.textContent = entry.error || reason;
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
