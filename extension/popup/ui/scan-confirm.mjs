import { brandOf } from '../../core/brands.mjs';
import { duplicateReasons, findDuplicate } from '../../core/duplicates.mjs';
import { cleanName } from '../../core/limits.mjs';
import { isSiteImage } from '../../core/site-icons.mjs';
import { displayHost, hostFromUrl, siteKey } from '../../core/sites.mjs';
import { t } from '../../shared/i18n.mjs';
import { readPageIcon } from '../../shared/site-icon.mjs';
import { createAccountIcon } from './account-icon.mjs';
import { NAME_REQUIRED, saveFailure, storedAccounts } from './account-input.mjs';
import { element, message } from './dom.mjs';
import { createMigrationPreview } from './migration-preview.mjs';
import { createSiteList } from './site-list.mjs';

// The Scanned code page confirms a code picked with Scan page: one account with an editable name and its sites, the
// scanned page's to begin with, or an export's list, which takes no site. A single code already stored gets the
// notice page instead. Above the name of one account come the icon it will have, the scanned page's site and its
// address: a bundled icon that the site or the name finds, else the page's own, which is kept with the account
// (core/site-icons.mjs), else the first letter. An unsaved code is lost on leaving.
export function createScanConfirm({ vault, notice, active, onSaved, onCancel }) {
  const form = element('#scan-confirm');
  const single = element('#scan-single');
  const name = element('#scan-name');
  const kind = element('#scan-type');
  const save = element('#scan-save');
  const error = element('#scan-error');
  const sites = createSiteList(element('#scan-sites'));
  const site = element('#scan-site');
  const siteName = element('#scan-site-name');
  const siteAddress = element('#scan-site-address');
  // The scanned page: its host, and its icon once the page gave one.
  let page = null;
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

  // The icon as the name typed so far and the scanned page give it.
  function showIcon() {
    if (!page) return;
    const label = cleanName(name.value);
    const brand = brandOf({ name: label, sites: [{ host: page.host }] });
    element('.account-icon', site).replaceWith(createAccountIcon(label || page.host, brand, page.image));
  }

  // The scanned page's site and address; its icon comes when the page gives it, unless a private window's.
  async function showSite(host, current) {
    page = host ? { host, image: null } : null;
    site.hidden = !page;
    if (!page) return;
    siteName.textContent = displayHost(siteKey(host));
    siteAddress.textContent = displayHost(host);
    showIcon();
    const shown = page;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (current !== revision || !tab || hostFromUrl(tab.url) !== host) return;
      const url = new URL(tab.url);
      const port = url.port ? `:${url.port}` : '';
      siteAddress.textContent = `${url.protocol}//${displayHost(host)}${port}${url.pathname}`;
      const stored = (await vault.siteIcons())[siteKey(host)];
      const image = isSiteImage(stored) ? stored : tab.incognito ? null : await readPageIcon({ tabId: tab.id });
      if (page !== shown || !image) return;
      page.image = image;
      showIcon();
    } catch { /* The site shows with a bundled icon or a letter. */ }
  }

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
      page = null;
      preview.show(next, duplicateReasons(next.accounts, accounts));
      return 'scan';
    }
    preview.clear();
    single.hidden = false;
    name.value = next.name;
    sites.show(host ? [host] : []);
    showSite(host, current);
    kind.textContent = next.type === 'hotp' ? t('scanTypeHotp') : t('scanTypeTotp');
    return 'scan';
  }

  function clear() {
    revision++;
    record = null;
    page = null;
    site.hidden = true;
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
    const siteEntries = isExport() ? [] : sites.readSites();
    if (!siteEntries) return;
    const records = (isExport() ? preview.selected() : [{ ...record, name: label }])
      .map(({ name: accountName, secret, type, counter }) => ({
        name: accountName, secret, type, counter, sites: siteEntries,
      }));
    if (!records.length) return;
    const current = revision;
    const scanned = isExport() ? null : page;
    saving = true;
    save.disabled = true;
    save.textContent = t('saving');
    message(error);
    try {
      const saved = await vault.addMany(records);
      // The page's icon stays only if the saved account still has the page's site.
      if (scanned?.image) await vault.keepSiteIcon(siteKey(scanned.host), scanned.image).catch(() => {});
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

  name.addEventListener('input', showIcon);
  form.addEventListener('submit', submit);
  element('#scan-cancel').addEventListener('click', cancel);
  return { show, clear, focus, cancel, get busy() { return saving; } };
}
