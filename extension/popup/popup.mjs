import { VaultSession } from '../core/vault.mjs';
import { VaultCopy } from '../core/vault-copy.mjs';
import { AFTER_UNLOCK_KEY, LEGACY_LOCAL_KEYS } from '../core/storage-keys.mjs';
import { RevealedCodes } from '../core/revealed-codes.mjs';
import { openAddCodeWindow } from '../shared/add-window.mjs';
import { element } from './ui/dom.mjs';
import { createViews } from './ui/views.mjs';
import { createAuthentication } from './ui/authentication.mjs';
import { createSettings } from './ui/settings.mjs';
import { createAccountList } from './ui/account-list.mjs';
import { createAddForm } from './ui/add-form.mjs';
import { createScanConfirm } from './ui/scan-confirm.mjs';
import { createAccountActions } from './ui/account-actions.mjs';
import { createAddMenu } from './ui/add-menu.mjs';
import { createUnlockSession } from './ui/unlock-session.mjs';
import { createScanResult } from './ui/scan-result.mjs';
import { createNotice } from './ui/notice.mjs';
import { createNewPassword } from './ui/new-password.mjs';
import { createPasswordCheck } from './ui/password-check.mjs';
import { createAfterUnlock } from './ui/after-unlock.mjs';
import { procedureStore } from './ui/procedure-store.mjs';
import { createSetup } from './ui/setup.mjs';
import { createReset } from './ui/reset-password.mjs';
import { createNewRecoveryKey } from './ui/recovery-key.mjs';
import { createMerge } from './ui/merge.mjs';
import { setUpPasswordFields } from './ui/password-fields.mjs';
import { setUpPasswordMeters } from './ui/password-meter.mjs';

// The same page is the toolbar popup and, with ?view=add, the Add code window.
const addWindow = new URLSearchParams(location.search).get('view') === 'add';
const homeView = addWindow ? 'add' : 'list';
document.body.classList.toggle('add-window', addWindow);
setUpPasswordFields();
setUpPasswordMeters();
const vault = new VaultSession(browser.storage.sync, browser.storage.session);
const vaultCopy = new VaultCopy(browser.storage.sync, browser.storage.local);
const revealed = new RevealedCodes(browser.storage.session);
const search = element('#search');
const addCodeButton = element('#add-code');
const scanButton = element('#scan');
// The + button and the entries of its menu, off while the Add code window opens.
const launchers = [element('#add'), addCodeButton, scanButton];
const settingsButton = element('#settings');
const timers = { navigation: 0, leave: 0, notice: 0 };
let opening = false;
let disposed = false;
let started = false;
const busy = () => form.busy || list.busy || settings.busy || actions.busy || scanConfirm.busy || newPassword.busy
  || recovery.busy || afterUnlock.busy || merge.busy || setup.busy;
const setLaunchersDisabled = (disabled) => {
  for (const button of launchers) button.disabled = disabled;
};

function clearTimers() {
  for (const timer of Object.values(timers)) clearTimeout(timer);
}

// While a view change or a save is running, calls retry again in 50 ms under the named timer and returns true.
function retryWhenBusy(timer, retry) {
  if (!views.changing && !busy()) return false;
  timers[timer] = setTimeout(retry, 50);
  return true;
}

const views = createViews({
  blocked: () => busy(), onAddEnter: () => form.reset(), onAddLeave: () => form.reset(), onChange: () => list.filter(),
});
const notice = createNotice({ views });
const list = createAccountList({
  vault, blocked: () => !session.unlocked || views.changing, onError: showError, onAdvanced: (id) => revealed.add(id),
  onMenu: (account, point) => actions.menu(account, point),
  onRemove: (account) => actions.remove(account),
  onRender: (records) => actions.sync(records),
});
const form = createAddForm({
  vault,
  active: () => session.unlocked && views.current === 'add',
  blocked: () => views.changing,
  async onSaved(records) {
    if (await session.show(records) && addWindow) window.close();
  },
  onCancel: () => window.close(),
});
// A code picked with Scan page, confirmed on its own page of the toolbar popup.
const scanConfirm = createScanConfirm({
  vault,
  notice,
  active: () => session.unlocked && views.current === 'scan',
  async onSaved(records) {
    if (await session.show(records)) leave();
  },
  onCancel: () => leave(),
});
const settings = createSettings({
  vault, storage: browser.storage.local, onRemember: (entry) => session.adopt(entry),
  // A change that failed because the vault locked meanwhile has nothing left to report.
  onError: (text) => { if (session.unlocked) showError(text); },
});
const addMenu = createAddMenu();
const actions = createAccountActions({
  vault,
  blocked: () => !session.unlocked || views.current !== 'list' || views.changing || list.busy,
  onOpen: (page, focus) => views.navigate(page, focus),
  onLeave: (id) => leave(() => list.focus(id)),
  onFocus: (id) => list.focus(id),
  neighbour: (id) => list.neighbour(id),
  onRenamed: (records) => session.show(records),
  async onRemoved(records, id) {
    if (!session.unlocked) return;
    revealed.delete(id).catch(() => {});
    await session.show(records);
  },
});
const auth = createAuthentication({
  vault,
  active: () => views.current === 'auth' && !session.unlocked,
  blocked: () => views.changing,
  // A password unlock starts a new session, in which every HOTP code is hidden again, and asks for the checks after
  // an unlock.
  async remember() {
    await revealed.clear();
    await settings.remember();
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true });
  },
  async onUnlocked(records) {
    session.begin();
    await session.show(records);
    // A scan result may have waited while this window asked for the password.
    await openUnlocked();
  },
  onForgot: () => reset.start(),
});
// Like the password page, it is not busy while it checks: once the password is right it opens the next page.
const check = createPasswordCheck({
  vault,
  active: () => session.unlocked && views.current === 'verify',
  blocked: () => views.changing,
});
const newPassword = createNewPassword();
const afterUnlock = createAfterUnlock({
  vault, views, notice, onError: showError,
  onMerge: (vaultId) => merge.start({ vaultId }),
  onDone: () => (views.current === 'list' ? undefined : views.navigate('list')),
});
// A popup that closes during the first setup, as the user copies or pastes a key elsewhere, goes on from the same
// choice and recovery key when it opens again; so do New recovery key, with the same key, Forgot password, from its
// recovery key, and another vault's codes, from its first page.
const store = procedureStore(browser.storage.session);
const recovery = createNewRecoveryKey({ vault, store, onDone: () => leaveVaultChange() });
const reset = createReset({
  vault, views, store, newPassword, blocked: () => views.changing, onDone: unlockedHere, onExit: showLockedView,
});
const setup = createSetup({
  vault, views, store, onDone: unlockedHere, onVaultArrived: leaveSetup,
});
const merge = createMerge({
  vault, views, store,
  // Another vault's codes are in: the checks after an unlock go on, with the key added twice and damaged codes.
  async onDone() {
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true }).catch(() => {});
    if (!(await afterUnlock.run().catch(() => false))) await views.navigate('list');
  },
  onExit: () => afterUnlock.reopen(),
});
const session = createUnlockSession({
  vault, list, auth, repair: () => vaultCopy.repair(), onEnded: lockVault,
  onFollowed: () => showUnlockedView(),
  onVaultsChanged: () => refreshAuth(),
});
const scan = createScanResult({
  addWindow, session, form, scanConfirm, notice, blocked: () => opening, onError: showError,
});

// The way back from each page reached from the list, shared by its back arrow, Escape, and its Cancel or Close.
const back = {
  settings: () => leave(() => settingsButton.focus()),
  scan: () => scanConfirm.cancel(),
  notice: () => closeNotice(),
  edit: () => actions.cancel(),
  remove: () => actions.cancel(),
  'setup-password': () => setup.back(),
  'setup-key': () => setup.back(),
  'get-codes': () => setup.back(),
  verify: () => leaveVaultChange(),
  password: () => newPassword.back(),
  reset: () => reset.back(),
  'merge-open': () => merge.back(),
  'merge-codes': () => merge.back(),
  'new-key': () => leaveVaultChange(),
  other: () => afterUnlock.back(),
  'remove-vault': () => afterUnlock.back(),
  duplicates: () => afterUnlock.back(),
};

// Back to the list from a page, once a view change or a save still running has finished; focus runs there
// instead of the list's own focus. Already on the list, only focus runs.
function leave(focus) {
  clearTimeout(timers.leave);
  if (disposed || !session.unlocked || retryWhenBusy('leave', () => leave(focus))) return;
  if (back[views.current]) views.navigate('list', focus);
  else if (views.current === 'list') focus?.();
}
async function showLockedView() {
  if (disposed || retryWhenBusy('navigation', showLockedView)) return;
  await views.navigate('auth');
  auth.focus();
}
async function showUnlockedView() {
  if (disposed || !session.unlocked || retryWhenBusy('navigation', showUnlockedView)) return;
  await openUnlocked();
}
// The first page once unlocked: the list, or straight the page of a code picked with Scan page, so that the list
// never shows in between. The Add code window opens on its form, which then takes a waiting result.
async function openUnlocked() {
  const page = await scan.prepare();
  if (!session.unlocked) return;
  await views.navigate(page ?? homeView, page === 'scan' ? scanConfirm.focus : undefined);
  await scan.take();
  // After an unlock, another vault, a key added twice and damaged accounts come before the list.
  if (!page && !addWindow) await afterUnlock.run().catch(() => {});
}
// Every error that does not belong to a form opens the notice page, once a view change or a save has finished.
function showError(text, title = 'Something went wrong') {
  clearTimeout(timers.notice);
  if (disposed || retryWhenBusy('notice', () => showError(text, title))) return;
  notice.show(title, text);
}
function closeNotice() {
  clearTimeout(timers.notice);
  if (disposed || retryWhenBusy('notice', closeNotice)) return;
  notice.close();
}
async function lockVault(revoke = true) {
  const cleared = session.lock(revoke);
  clearTimers();
  auth.cancel();
  form.reset();
  actions.close();
  addMenu.close();
  scan.clear();
  clearVaultChange();
  afterUnlock.clear();
  setup.stop();
  store.clear();
  search.value = '';
  list.clear();
  auth.configure();
  await showLockedView();
  if (!(await cleared)) showError('Could not clear the remembered unlock. Close Firefox to clear it.');
}
async function openAddWindow() {
  if (opening) return;
  opening = true;
  setLaunchersDisabled(true);
  try {
    await session.handOff(true);
    await openAddCodeWindow();
  }
  catch {
    session.cancelHandOff();
    showError('Could not open the Add code window. Please try again.');
  }
  finally {
    opening = false;
    setLaunchersDisabled(false);
  }
}
// Change password and New recovery key, from Settings: the password first, then the change. Back on either page,
// and the end of the change, return to Settings.
const VAULT_CHANGES = {
  password: {
    setting: '#change-password',
    title: 'Change password',
    description: 'Enter your password to choose a new one.',
    prepare: () => newPassword.reset(),
    next(password) {
      // The vault key stays, so other computers keep their unlock.
      newPassword.start({
        label: 'Change password',
        backLabel: 'Back to settings',
        save: async (next) => {
          await vault.changePassword(password, next);
          return true;
        },
        failure: 'Could not change the password. Please try again.',
        done: leaveVaultChange,
        back: leaveVaultChange,
      });
      return views.navigate('password');
    },
  },
  recovery: {
    setting: '#new-recovery-key',
    title: 'New recovery key',
    description: 'A new key will replace the one you saved before. Enter your password to continue.',
    prepare: (state) => recovery.prepare(state),
    next(password) {
      recovery.start(password);
      return views.navigate('new-key');
    },
  },
};
let vaultChange = null;
// state: what a popup that closed kept of New recovery key.
async function startVaultChange(name, state = {}) {
  if (busy() || check.busy) return;
  vaultChange = VAULT_CHANGES[name];
  await vaultChange.prepare(state);
  check.show({ title: vaultChange.title, description: vaultChange.description, onChecked: vaultChange.next });
  await views.navigate('verify');
}
function clearVaultChange() {
  check.reset();
  newPassword.reset();
  recovery.reset();
  vaultChange = null;
}
async function leaveVaultChange() {
  if (busy() || check.busy) return;
  const setting = vaultChange?.setting ?? '#change-password';
  clearVaultChange();
  await store.clear();
  await views.navigate('settings', () => element(setting).focus());
}
// The vault opened by the setup or Forgot password: a new session, as after a password unlock, with the checks after
// an unlock.
async function unlockedHere(records) {
  try {
    await revealed.clear();
    await settings.remember();
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true });
  } catch { /* Only this popup holds the unlock; other windows ask for the password. */ }
  session.begin();
  await session.show(records);
  await openUnlocked();
}
// A vault arrived from Firefox Sync during the setup: the password page opens it.
async function leaveSetup() {
  setup.stop();
  await store.clear();
  auth.configure();
  await showLockedView();
}
// The last vault went while the password page showed: the setup starts.
async function refreshAuth() {
  if (!started || disposed || session.unlocked || auth.busy || views.current !== 'auth') return;
  if (!(await vault.exists()) && views.current === 'auth' && !session.unlocked) await setup.start({});
}
function revealAuth() {
  element('#auth-header').hidden = false;
  element('#auth-form').hidden = false;
}
async function initialize() {
  try {
    // The version 1 vault is not read: vaults now live in storage.sync.
    browser.storage.local.remove(LEGACY_LOCAL_KEYS).catch(() => {});
    await settings.load();
    // A lost vault goes back before the remembered unlock is read, which would otherwise be dropped. The background
    // script keeps the copy in line; refreshing it here too covers a background that did not run.
    await vaultCopy.repair();
    vaultCopy.refresh().catch(() => {});
    const kept = addWindow ? null : await store.load();
    if (await session.restore()) {
      // New recovery key and another vault's codes go on where a closed popup left them.
      if (kept?.run === 'recovery') await startVaultChange('recovery', kept);
      else if (kept?.run === 'merge') await merge.start(kept);
      else {
        if (kept) await store.clear();
        await openUnlocked();
      }
    } else {
      vault.lock();
      auth.configure();
      if (!addWindow && !(await vault.exists())) await setup.start(kept?.run === 'setup' ? kept : {});
      else if (kept?.run === 'reset') await reset.start();
      else {
        if (kept) await store.clear();
        revealAuth();
      }
    }
  } catch {
    revealAuth();
    auth.showError('Could not access local storage. Reload the extension and try again.');
  } finally {
    element('#initial-loading').hidden = true;
    document.documentElement.removeAttribute('data-starting');
    // Focus does not take while the popup is hidden. A page opened before it showed (a Scan page result) is
    // focused now; the list still opens with nothing focused.
    if (views.current === 'auth') auth.focus();
    else if (views.current !== homeView) views.focusPage();
    session.ready();
    started = true;
  }
}

addCodeButton.addEventListener('click', openAddWindow);
scanButton.addEventListener('click', () => scan.start());
element('#lock-vault').addEventListener('click', () => lockVault());
element('#notice-close').addEventListener('click', closeNotice);
for (const button of document.querySelectorAll('header .back')) {
  button.addEventListener('click', () => back[views.current]?.());
}
element('#change-password').addEventListener('click', () => startVaultChange('password'));
element('#new-recovery-key').addEventListener('click', () => startVaultChange('recovery'));
settingsButton.addEventListener('click', () => {
  if (search.value) { search.value = ''; list.filter(); search.focus(); }
  else views.navigate('settings');
});
// Escape goes back from a page, and closes the Add code window; on the list it closes the popup, as by default.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (back[views.current]) {
    event.preventDefault();
    back[views.current]();
  } else if (views.current === 'add') {
    event.preventDefault();
    if (!form.busy) window.close();
  }
});
// Firefox's Save page (Ctrl+S) and Print (Ctrl+P) would save or print the extension's own page: here they do nothing.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && ['s', 'p'].includes(event.key.toLowerCase())) event.preventDefault();
});
window.addEventListener('pagehide', () => {
  disposed = true;
  session.dispose();
  clearTimers();
  auth.cancel();
  form.reset();
  list.dispose();
}, { once: true });
initialize();
