import { MAX_SITES } from '../../core/limits.mjs';
import { displayHost, hostFromText, siteKey } from '../../core/sites.mjs';
import { t } from '../../shared/i18n.mjs';
import { element, message } from './dom.mjs';

// Gives each new row's error its own ID, across the three lists of the page.
let rowCount = 0;

// The Sites list of the Scanned code page, the Add code form and the Edit code page, inside root: one row per site
// with its remove button, then Add a site, which adds a row to type one in. Nothing is stored here: the page stores
// what read() gives, and a page left without saving drops the rows.
export function createSiteList(root) {
  const rows = element('.site-rows', root);
  const add = element('.add-site', root);
  // The rows in order: { node, host } for a site the list was shown with, { node, input, error } for a new one.
  let entries = [];

  // Add a site goes once the list has MAX_SITES rows, empty ones included.
  function update() {
    add.hidden = entries.length >= MAX_SITES;
  }

  function remove(entry) {
    const index = entries.indexOf(entry);
    if (index === -1) return;
    entries.splice(index, 1);
    entry.node.remove();
    update();
    // Focus stays in the list: on the row that took its place, the one before, or Add a site.
    const next = entries[index] ?? entries[index - 1];
    (next ? element('.site-remove', next.node) : add).focus();
  }

  function removeButton(label, entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button site-remove';
    button.setAttribute('aria-label', label);
    const icon = document.createElement('span');
    icon.className = 'icon icon-close';
    button.append(icon);
    button.addEventListener('click', () => remove(entry));
    return button;
  }

  function siteRow(host) {
    const entry = { host, node: document.createElement('li') };
    entry.node.className = 'site-row';
    const text = document.createElement('span');
    text.className = 'site-host';
    text.textContent = displayHost(host);
    entry.node.append(text, removeButton(t('removeSite', text.textContent), entry));
    return entry;
  }

  function newRow() {
    const entry = { node: document.createElement('li') };
    entry.node.className = 'site-row';
    const input = document.createElement('input');
    input.className = 'field';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t('sitePlaceholder');
    input.setAttribute('aria-label', t('newSite'));
    const error = document.createElement('p');
    error.className = 'error';
    error.id = `site-error-${++rowCount}`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    Object.assign(entry, { input, error });
    input.addEventListener('input', () => mark(entry));
    entry.node.append(input, removeButton(t('removeNewSite'), entry), error);
    return entry;
  }

  // The list shows hosts, the sites already there, and no new row.
  function show(hosts = []) {
    entries = hosts.map(siteRow);
    rows.replaceChildren(...entries.map((entry) => entry.node));
    update();
  }

  // Shows text under a new row, or clears it without text.
  function mark(entry, text = '') {
    message(entry.error, text);
    if (text) entry.input.setAttribute('aria-invalid', 'true');
    else entry.input.removeAttribute('aria-invalid');
  }

  // { kept, added }: the hosts of the rows the list was shown with that are still there, and those typed in new rows.
  // Empty rows count for nothing. null when a row is not a site, or is the same site as a row above it (the same
  // registrable domain, or the same host for a host without one): its error shows under it, and the first such row
  // is focused.
  function read() {
    const kept = entries.filter((entry) => !entry.input).map((entry) => entry.host);
    // Each site of the list, by siteKey(), as the first row that has it shows it.
    const shown = new Map();
    for (const host of kept) {
      const key = siteKey(host);
      if (!shown.has(key)) shown.set(key, displayHost(host));
    }
    const added = [];
    let invalid = null;
    for (const entry of entries) {
      if (!entry.input) continue;
      // A row that was in the way may have gone since the last check.
      mark(entry);
      if (!entry.input.value.trim()) continue;
      const host = hostFromText(entry.input.value);
      const key = host ? siteKey(host) : null;
      let problem = null;
      if (!host) problem = t('invalidSite');
      else if (shown.has(key)) problem = t('sameSite', shown.get(key));
      if (problem) {
        mark(entry, problem);
        invalid ??= entry;
        continue;
      }
      shown.set(key, displayHost(host));
      added.push(host);
    }
    if (invalid) {
      invalid.input.focus();
      return null;
    }
    return { kept, added };
  }

  add.addEventListener('click', () => {
    if (entries.length >= MAX_SITES) return;
    const entry = newRow();
    entries.push(entry);
    rows.append(entry.node);
    update();
    entry.input.focus();
  });

  return { show, read };
}
