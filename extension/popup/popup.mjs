import { VaultSession } from '../core/vault.mjs';
import { VaultCopy } from '../core/vault-copy.mjs';
import { Recovery } from '../core/recovery.mjs';
import {
  AFTER_UNLOCK_KEY, KEPT_COPY_KEY, LEGACY_LOCAL_KEYS, SCAN_TARGET_KEY, parseItem,
} from '../core/storage-keys.mjs';
import { isHost } from '../core/sites.mjs';
import { RevealedCodes } from '../core/revealed-codes.mjs';
import { MergeReceipts } from '../core/merge-receipts.mjs';
import { openAddCodeWindow } from '../shared/add-window.mjs';
import { t } from '../shared/i18n.mjs';
import { blockPageCommands, element, localize } from './ui/dom.mjs';
import { createViews } from './ui/views.mjs';
import { createAuthentication } from './ui/authentication.mjs';
import { createSettings, normalizeSettings } from './ui/settings.mjs';
import { createAccountList } from './ui/account-list.mjs';
import { createAddForm } from './ui/add-form.mjs';
import { createScanConfirm } from './ui/scan-confirm.mjs';
import { createAccountActions } from './ui/account-actions.mjs';
import { createAddMenu } from './ui/add-menu.mjs';
import { createUnlockSession } from './ui/unlock-session.mjs';
import { createScanResult } from './ui/scan-result.mjs';
import { createFillPage } from './ui/fill-page.mjs';
import { createNotice } from './ui/notice.mjs';
import { createNewPassword } from './ui/new-password.mjs';
import { createPasswordCheck } from './ui/password-check.mjs';
import { createAfterUnlock } from './ui/after-unlock.mjs';
import { procedureStore } from './ui/procedure-store.mjs';
import { createSetup } from './ui/setup.mjs';
import { createReset } from './ui/reset-password.mjs';
import { createNewRecoveryKey } from './ui/recovery-key.mjs';
import { createMerge } from './ui/merge.mjs';
import { createRestoreCopy } from './ui/restore-copy.mjs';
import { createRecoveryView } from './ui/recovery-view.mjs';
import { setUpPasswordFields } from './ui/password-fields.mjs';
import { setUpPasswordHints } from './ui/password-meter.mjs';

// The same page is the toolbar popup and, with ?view=add, the Add code window.
const addWindow = new URLSearchParams(location.search).get('view') === 'add';
const homeView = addWindow ? 'add' : 'list';
document.body.classList.toggle('add-window', addWindow);
localize();
setUpPasswordFields();
setUpPasswordHints();
const vault = new VaultSession(
  browser.storage.sync, browser.storage.session, undefined, undefined, browser.storage.local,
);
const readOnly = new Recovery(browser.storage.sync, browser.storage.local);
const vaultCopy = new VaultCopy(browser.storage.sync, browser.storage.local);
const revealed = new RevealedCodes(browser.storage.session);
const receipts = new MergeReceipts(browser.storage.local);
const search = element('#search');
const addCodeButton = element('#add-code');
const scanButton = element('#scan');
// The + button and the entries of its menu, off while the Add code window opens.
const launchers = [element('#add'), addCodeButton, scanButton];
const settingsButton = element('#settings');
const timers = { navigation: 0, leave: 0, notice: 0, change: 0 };
let opening = false;
let disposed = false;
let started = false;
const busy = () => form.busy || list.busy || settings.busy || actions.busy || scanConfirm.busy || newPassword.busy
  || recovery.busy || afterUnlock.busy || merge.busy || setup.busy || restoreCopy.busy || fillPage.busy;
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
// The Add code window proposes the site of the page where the toolbar popup that opened it was, read once: a window
// already open, brought forward from another tab, keeps its form as it is.
const proposedSite = addWindow
  ? browser.storage.session.get(SCAN_TARGET_KEY)
    .then(({ [SCAN_TARGET_KEY]: target }) => (isHost(target?.host) ? target.host : null), () => null)
  : Promise.resolve(null);
const form = createAddForm({
  vault,
  active: () => session.unlocked && views.current === 'add',
  blocked: () => views.changing,
  proposedSite,
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
  vault, storage: browser.storage.local,
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
  vault, recovery: readOnly,
  active: () => views.current === 'auth' && !session.unlocked,
  blocked: () => views.changing,
  // A password unlock starts a new session, in which every HOTP code is hidden again, and asks for the checks after
  // an unlock. The background script must let this window hold it.
  async remember() {
    await revealed.clear();
    await settings.remember(session.windowId);
    if (!(await session.claim())) throw new Error('Unlock refused');
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true });
  },
  async onUnlocked(records) {
    session.begin();
    await session.show(records);
    // A scan result may have waited while this window asked for the password.
    await openUnlocked();
  },
  onForgot: () => reset.start(),
  onRecover: (found) => recoveryView.start(found).catch(() => showError(t('readCodesFailed'))),
});
// The time of Lock automatically, also for Codes, read-only: 1 minute with When the popup closes, null with Never.
const recoveryView = createRecoveryView({
  recovery: readOnly, views,
  async minutes() {
    const { autoLock } = normalizeSettings(await browser.storage.local.get('autoLock'));
    if (autoLock === 'never') return null;
    return autoLock === 'close' ? 1 : autoLock;
  },
  onExit: () => leaveRestore(),
});
// Like the password page, it is not busy while it checks: once the password is right it opens the next page.
const check = createPasswordCheck({
  vault,
  active: () => session.unlocked && views.current === 'verify',
  blocked: () => views.changing,
});
const newPassword = createNewPassword();
const afterUnlock = createAfterUnlock({
  vault, views, notice, receipts, onError: showError,
  onMerge: (vaultId) => merge.start({ vaultId }),
  onSettings: () => views.navigate('settings', () => element('#other-vaults').focus()),
  onDone: () => (views.current === 'list' ? undefined : views.navigate('list')),
});
// A popup that closes during the first setup, as the user copies or pastes a key elsewhere, goes on from the same
// choice and recovery key when it opens again; so do New recovery key, with the same key, Forgot password, from its
// recovery key, and another vault's codes, from its first page.
const store = procedureStore(browser.storage.session, {
  onError: () => showError(t('clearProgressFailed')),
});
const recovery = createNewRecoveryKey({ vault, store, onDone: () => leaveVaultChange(true) });
const reset = createReset({
  vault, views, store, newPassword, blocked: () => views.changing, onDone: unlockedHere, onExit: showLockedView,
});
const setup = createSetup({
  vault, views, store, onDone: unlockedHere, onVaultArrived: leaveSetup,
});
const merge = createMerge({
  vault, views, store, receipts,
  // Another vault's codes are copied: the checks after an unlock go on, with the key added twice and damaged codes.
  async onDone() {
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true }).catch(() => {});
    if (!(await afterUnlock.run().catch(() => false))) await views.navigate('list');
  },
  onExit: () => afterUnlock.reopen(),
});
// A vault that left Firefox Sync goes back only from these pages, with its password or recovery key. They start from
// the setup or the password page, and lead back there.
const restoreCopy = createRestoreCopy({
  copy: vaultCopy, views,
  onDone: () => leaveRestore(t('vaultBack')),
  onExit: () => leaveRestore(),
});
const session = createUnlockSession({
  vault, list, auth, onEnded: lockVault,
  onFollowed: () => showUnlockedView(),
  onVaultsChanged: () => refreshAuth(),
});
const scan = createScanResult({
  addWindow, session, form, scanConfirm, notice, blocked: () => opening, onError: showError,
});
// A code to put into the page field whose context menu opened this popup.
const fillPage = createFillPage({ vault, revealed, addWindow, onLeave: () => leave() });

// The way back from each page reached from the list, shared by its back arrow, Escape, and its Cancel or Close.
const back = {
  settings: () => leave(() => settingsButton.focus()),
  scan: () => scanConfirm.cancel(),
  notice: () => closeNotice(),
  edit: () => actions.cancel(),
  fill: () => fillPage.cancel(),
  remove: () => actions.cancel(),
  'setup-password': () => setup.back(),
  'setup-key': () => setup.back(),
  'get-codes': () => setup.back(),
  verify: () => leaveVaultChange(),
  password: () => newPassword.back(),
  reset: () => reset.back(),
  'merge-open': () => merge.back(),
  'merge-codes': () => merge.back(),
  recovery: () => recoveryView.stop(),
  'restore-open': () => restoreCopy.back(),
  'restore-codes': () => restoreCopy.back(),
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
// never shows in between. The Add code window opens on its form, which then takes a waiting result. A code to put
// into a page comes before all: it fills the field and closes the popup, or opens the page to choose an account; a
// Scan page result waiting is dropped, and the checks after an unlock wait for the next opening.
async function openUnlocked() {
  recoveryView.clear();
  const fill = await fillPage.prepare();
  if (!session.unlocked || fill === 'done') return;
  if (fill === 'fill') {
    scan.clear();
    await views.navigate('fill');
    return;
  }
  const page = await scan.prepare();
  if (!session.unlocked) return;
  await views.navigate(page ?? homeView, page === 'scan' ? scanConfirm.focus : undefined);
  await scan.take();
  // After an unlock, another vault, a key added twice and damaged accounts come before the list.
  if (!page && !addWindow) await afterUnlock.run().catch(() => {});
}
// Every error that does not belong to a form opens the notice page, once a view change or a save has finished.
function showError(text, title = t('errorTitle')) {
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
  fillPage.clear();
  clearVaultChange();
  afterUnlock.clear();
  setup.stop();
  merge.reset();
  restoreCopy.reset();
  recoveryView.clear();
  const forgotten = store.clear().then(() => true, () => false);
  search.value = '';
  list.clear();
  auth.configure();
  await showLockedView();
  if (!(await cleared) || !(await forgotten)) {
    showError(t('clearUnlockFailed'));
  }
}
async function openAddWindow() {
  if (opening) return;
  opening = true;
  setLaunchersDisabled(true);
  try {
    await session.handOff();
    const { created } = await openAddCodeWindow();
    if (!created) session.cancelHandOff();
  }
  catch {
    session.cancelHandOff();
    showError(t('openAddWindowFailed'));
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
    title: t('changePassword'),
    description: t('changePasswordPrompt'),
    prepare: () => newPassword.reset(),
    next(password) {
      // The vault key stays, so other computers keep their unlock.
      newPassword.start({
        label: t('changePassword'),
        backLabel: t('backToSettings'),
        save: async (next) => {
          await vault.changePassword(password, next);
          return true;
        },
        failure: t('changePasswordFailed'),
        done: () => leaveVaultChange(true),
        back: () => leaveVaultChange(),
      });
      return views.navigate('password');
    },
  },
  recovery: {
    setting: '#new-recovery-key',
    title: t('newRecoveryKey'),
    description: t('newKeyPrompt'),
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
// saved: the change is done. Back is ignored while a page is busy; the end of a change waits instead, since the
// password page that led to it may still be finishing its move to the next page, and a lost end would leave the new
// key on the page.
async function leaveVaultChange(saved = false) {
  clearTimeout(timers.change);
  if (busy() || check.busy) {
    if (saved && !disposed) timers.change = setTimeout(() => leaveVaultChange(true), 50);
    return;
  }
  const setting = vaultChange?.setting ?? '#change-password';
  clearVaultChange();
  await store.leave(() => views.navigate('settings', () => element(setting).focus()));
}
// The vault opened by the setup or Forgot password: a new session, as after a password unlock, with the checks after
// an unlock.
async function unlockedHere(records) {
  try {
    await revealed.clear();
    await settings.remember(session.windowId);
    if (!(await session.claim())) throw new Error('Unlock refused');
    await browser.storage.session.set({ [AFTER_UNLOCK_KEY]: true });
  } catch {
    // Only this popup holds the unlock; other windows ask for the password.
    await vault.forget(vault.sessionId).catch(() => {});
  }
  session.begin();
  await session.show(records);
  await openUnlocked();
}
// A vault arrived from Firefox Sync during the setup: the password page opens it.
async function leaveSetup() {
  setup.stop();
  await store.leave(() => {
    auth.configure();
    return showLockedView();
  });
}
// Restore this computer's copy shows on the setup and the password page while the copy keeps a vault.
async function showRestoreLinks() {
  const kept = await vaultCopy.kept().then((vaults) => vaults.length > 0, () => false);
  element('#choose-copy').hidden = !kept;
  element('#restore-copy').hidden = !kept;
}
async function startRestore() {
  if (disposed || session.unlocked || busy() || auth.busy || views.changing) return;
  auth.cancel();
  setup.stop();
  await restoreCopy.start();
}
// Back from restoring: to the password page with a vault, or else to the setup. text replaces its description.
async function leaveRestore(text) {
  if (disposed || session.unlocked) return;
  await showRestoreLinks();
  if (!(await vault.exists())) {
    await setup.start({});
    return;
  }
  auth.configure();
  if (text) element('#auth-description').textContent = text;
  revealAuth();
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
    // The background script keeps the copy in line, and keeps a lost vault aside; refreshing it here too covers a
    // background that did not run. Restore this computer’s copy shows once it has run.
    vaultCopy.refresh().catch(() => {}).then(showRestoreLinks);
    const kept = addWindow ? null : await store.load(vault);
    if (await session.restore()) {
      // New recovery key and another vault's codes go on where a closed popup left them.
      if (kept?.run === 'recovery') await startVaultChange('recovery', kept);
      else if (kept?.run === 'merge') await merge.start(kept);
      else {
        if (kept) await store.forget();
        await openUnlocked();
      }
    } else {
      vault.lock();
      auth.configure();
      if (!addWindow && !(await vault.exists())) await setup.start(kept?.run === 'setup' ? kept : {});
      else if (kept?.run === 'reset') await reset.start();
      else {
        if (kept) await store.forget();
        revealAuth();
      }
    }
  } catch {
    revealAuth();
    auth.showError(t('storageFailed'));
  } finally {
    element('#initial-loading').hidden = true;
    document.documentElement.removeAttribute('data-starting');
    // Focus does not take while the popup is hidden: the page that opened before it showed is focused now, the list on
    // its search field. The Add code window opens on its form as it is.
    if (views.current === 'auth') auth.focus();
    else if (views.current !== 'add') views.focusPage();
    session.ready();
    started = true;
  }
}

addCodeButton.addEventListener('click', openAddWindow);
scanButton.addEventListener('click', () => scan.start());
element('#lock-vault').addEventListener('click', () => lockVault());
element('#notice-close').addEventListener('click', closeNotice);
element('#recovery-close').addEventListener('click', () => recoveryView.stop());
for (const button of document.querySelectorAll('header .back')) {
  button.addEventListener('click', () => back[views.current]?.());
}
element('#change-password').addEventListener('click', () => startVaultChange('password'));
element('#choose-copy').addEventListener('click', startRestore);
element('#restore-copy').addEventListener('click', startRestore);
browser.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' && KEPT_COPY_KEY in changes) || (area === 'sync' && Object.keys(changes).some(parseItem))) {
    showRestoreLinks();
  }
});
element('#new-recovery-key').addEventListener('click', () => startVaultChange('recovery'));
settingsButton.addEventListener('click', async () => {
  if (search.value) { search.value = ''; list.filter(); search.focus(); return; }
  // Another vault shows while there is one, copied or not.
  element('#other-vaults').hidden = !(await vault.others().then((others) => others.length > 0, () => false));
  views.navigate('settings');
});
element('#other-vaults').addEventListener('click', () => afterUnlock.showOther());
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
blockPageCommands();
window.addEventListener('pagehide', () => {
  disposed = true;
  session.dispose();
  clearTimers();
  auth.cancel();
  form.reset();
  list.dispose();
}, { once: true });
initialize();
