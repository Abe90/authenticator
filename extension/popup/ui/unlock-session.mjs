import {
  AFTER_UNLOCK_KEY, CLOSED_STORAGE_KEY, HANDOFF_STORAGE_KEY, REVEALED_STORAGE_KEY, UNLOCK_STORAGE_KEY, parseItem,
} from '../../core/storage-keys.mjs';
import { readRevealed } from '../../core/revealed-codes.mjs';
import { HANDOFF_MS } from '../../shared/add-window.mjs';
import { announceWindow } from '../../shared/open-windows.mjs';

const SESSION_KEYS = [
  UNLOCK_STORAGE_KEY, REVEALED_STORAGE_KEY, HANDOFF_STORAGE_KEY, AFTER_UNLOCK_KEY, CLOSED_STORAGE_KEY,
];

// Extension pages share a process, so this sees every popup and Add code window. The background page is a view
// too, so only 'popup' and 'tab' views count.
function otherWindowsOpen() {
  try {
    const pages = [...browser.extension.getViews({ type: 'popup' }), ...browser.extension.getViews({ type: 'tab' })];
    return pages.some((page) => page !== window);
  } catch { return false; }
}

// A timed unlock ends its minutes after the last extension window closed; a close time that is not a number ends it
// too. No timer runs while a window is open.
function timedOut(entry, closedAt) {
  if (!Number.isSafeInteger(entry.minutesAfterClose) || closedAt === undefined) return false;
  return !Number.isSafeInteger(closedAt) || Date.now() >= closedAt + entry.minutesAfterClose * 60000;
}

// This window's unlock, kept in line with the remembered unlock all windows share. repair() puts back a vault that
// Firefox Sync lost, before a change to the vaults is followed; onEnded(revoke) locks this window, and with revoke
// every window; onFollowed() shows the codes after following another window's unlock; onVaultsChanged() tells a
// locked window that a vault came or went through Firefox Sync.
export function createUnlockSession({ vault, list, auth, repair, onEnded, onFollowed, onVaultsChanged }) {
  const storage = browser.storage.session;
  let unlocked = false;
  // Bumped by every lock, so asynchronous work started before it can tell its outcome is stale.
  let lockRevision = 0;
  let readRevision = 0;
  let lockOnClose = false;
  let handoffUntil = 0;
  // The latest remembered unlock announced by a change event, for a restore that read an older one meanwhile.
  let latestEntry = null;
  let entryEvents = 0;
  let followTimer = 0;
  let following = false;
  let started = false;
  let disposed = false;
  // Until this window closes, the background script counts it as open.
  const leave = announceWindow();

  // Takes how the remembered unlock ends: { minutesAfterClose, lockOnClose }.
  function adopt(entry) {
    lockOnClose = entry?.lockOnClose === true;
  }

  // Shows records saved here or in another window; false once the vault has locked.
  async function show(records) {
    if (!unlocked) return false;
    list.render(records);
    await list.update();
    return true;
  }

  // Restores the remembered unlock and shows its codes; false when there is none or a lock overtook the restore.
  async function restore() {
    const currentLock = lockRevision;
    const events = entryEvents;
    const records = await vault.restore();
    if (!records) return false;
    // Read again for the expiry; another window may have locked since the restore.
    const stored = await storage.get(SESSION_KEYS);
    const { [UNLOCK_STORAGE_KEY]: entry, [HANDOFF_STORAGE_KEY]: handoff } = stored;
    if (!entry || currentLock !== lockRevision) {
      if (currentLock === lockRevision) vault.lock();
      return false;
    }
    // A handoff from the popup that opened this window, or from the background after a scan, allows one restore.
    const handedOff = Number.isSafeInteger(handoff) && Date.now() < handoff;
    const ended = (entry.lockOnClose === true && !handedOff) || timedOut(entry, stored[CLOSED_STORAGE_KEY]);
    if (ended && !otherWindowsOpen()) {
      // Every window of that unlock has closed and it has ended since; the closing window could not clear it.
      vault.lock();
      await storage.remove(SESSION_KEYS);
      return false;
    }
    // The handoff is used; with this window open no timer runs, and the background script records the next close.
    const used = [HANDOFF_STORAGE_KEY, CLOSED_STORAGE_KEY].filter((key) => stored[key] !== undefined);
    if (used.length) storage.remove(used).catch(() => {});
    unlocked = true;
    list.reveal(readRevealed(stored[REVEALED_STORAGE_KEY]));
    list.render(records);
    // A change event during the restore was dropped, since only unlocked windows follow them.
    adopt(entryEvents !== events ? latestEntry : entry);
    await list.update();
    return unlocked;
  }

  // Another window unlocked: follow it, once start-up and any unlock attempt here have finished.
  async function follow() {
    clearTimeout(followTimer);
    if (unlocked || disposed || following) return;
    if (!started || auth.busy) {
      followTimer = setTimeout(follow, 50);
      return;
    }
    following = true;
    auth.cancel();
    try {
      if (await restore()) await onFollowed();
    } catch {
      // The password form stays available.
    } finally {
      following = false;
    }
  }

  // Each read starts after its write landed, so the latest one shows the stored state; older ones may finish later.
  async function reload() {
    const currentLock = lockRevision;
    const currentRead = ++readRevision;
    try {
      const records = await vault.read();
      if (currentLock === lockRevision && currentRead === readRevision) await show(records);
    } catch { if (currentLock === lockRevision) await onEnded(false); }
  }

  async function changed(changes, area) {
    if (area === 'sync') {
      if (!Object.keys(changes).some((key) => parseItem(key))) return;
      // Its write back is another change, which reloads again.
      await repair();
      // A read fails once this vault is no longer the main one, which locks this window.
      if (unlocked) await reload();
      else onVaultsChanged();
      return;
    }
    if (area !== 'session') return;
    const entry = changes[UNLOCK_STORAGE_KEY];
    if (entry?.newValue) {
      latestEntry = entry.newValue;
      entryEvents++;
      if (unlocked) adopt(entry.newValue);
      else follow();
    } else if (entry) {
      if (unlocked || auth.busy) await onEnded(false);
      else {
        // Invalidate a restore still in progress, without clearing a password being typed.
        lockRevision++;
        vault.lock();
      }
    }
    const ids = changes[REVEALED_STORAGE_KEY]?.newValue;
    if (ids && unlocked) {
      list.reveal(readRevealed(ids));
      await list.update();
    }
  }

  // Resolves to false when the remembered unlock could not be cleared.
  async function lock(revoke = true) {
    unlocked = false;
    lockRevision++;
    lockOnClose = false;
    clearTimeout(followTimer);
    vault.lock();
    if (!revoke) return true;
    try {
      await storage.remove(SESSION_KEYS);
      return true;
    } catch { return false; }
  }

  // Lets the window opened next restore an unlock that ends with the popup; for a scan the background stores it.
  async function handOff(store) {
    if (!lockOnClose) return;
    handoffUntil = Date.now() + HANDOFF_MS;
    if (store) await storage.set({ [HANDOFF_STORAGE_KEY]: handoffUntil });
  }

  function dispose() {
    disposed = true;
    // "When the popup closes": the last extension window to close ends the unlock. Firefox drops storage calls
    // made while a window closes (they only run when the page navigates), so the next start enforces it.
    if (unlocked && lockOnClose && Date.now() >= handoffUntil && !otherWindowsOpen()) {
      storage.remove(SESSION_KEYS).catch(() => {});
    }
    leave();
    clearTimeout(followTimer);
    browser.storage.onChanged.removeListener(changed);
    vault.lock();
  }

  browser.storage.onChanged.addListener(changed);
  return {
    restore, show, adopt, lock, handOff, dispose,
    // A password unlock in this window.
    begin() {
      unlocked = true;
      storage.remove(CLOSED_STORAGE_KEY).catch(() => {});
    },
    // The window was not opened after all.
    cancelHandOff() {
      if (!handoffUntil) return;
      handoffUntil = 0;
      storage.remove(HANDOFF_STORAGE_KEY).catch(() => {});
    },
    // Start-up has finished: unlocks made in other windows are followed from now on.
    ready() { started = true; },
    get unlocked() { return unlocked; },
  };
}
