import { REVEALED_STORAGE_KEY, UNLOCK_STORAGE_KEY, parseItem } from '../../core/storage-keys.mjs';
import { revokeUnlock } from '../../core/auto-lock.mjs';
import { readRevealed } from '../../core/revealed-codes.mjs';
import { announceWindow } from '../../shared/open-windows.mjs';

// Following another window's new unlock can arrive before that window has claimed it: the claim is asked again
// this often, for as long as a handoff lasts.
const FOLLOW_RETRY_MS = 250;
const FOLLOW_TRIES = 40;

// This window's unlock, kept in line with the remembered unlock all windows share. The background script decides
// whether this window may hold it, and ends it (core/auto-lock.mjs). onEnded(revoke) locks this window, and with
// revoke every window; onFollowed() shows the codes after following another window's unlock; onVaultsChanged() tells
// a locked window that a vault came or went through Firefox Sync.
export function createUnlockSession({ vault, list, auth, onEnded, onFollowed, onVaultsChanged }) {
  const storage = browser.storage.session;
  let unlocked = false;
  // Bumped by every lock, so asynchronous work started before it can tell its outcome is stale.
  let lockRevision = 0;
  let readRevision = 0;
  // The latest remembered unlock announced by a change event, for a restore that read an older one meanwhile.
  let latestEntry = null;
  let entryEvents = 0;
  let followTimer = 0;
  let followTries = 0;
  let following = false;
  let refused = false;
  let started = false;
  let disposed = false;
  // The background script counts this window as holding the unlock from a granted claim until it locks or closes.
  const link = announceWindow();

  // Shows records saved here or in another window; false once the vault has locked.
  async function show(records) {
    if (!unlocked) return false;
    list.render(records);
    await list.update();
    return true;
  }

  function followSoon(delay) {
    clearTimeout(followTimer);
    followTimer = setTimeout(follow, delay);
  }

  // Restores the remembered unlock and shows its codes; false when there is none, the background script refused it,
  // or a lock overtook the restore.
  async function restore() {
    refused = false;
    const currentLock = lockRevision;
    const events = entryEvents;
    const records = await vault.restore();
    if (!records) return false;
    // Read again: another window may have locked or unlocked again since the restore.
    const stored = await storage.get([UNLOCK_STORAGE_KEY, REVEALED_STORAGE_KEY]);
    const entry = stored[UNLOCK_STORAGE_KEY];
    if (!entry || currentLock !== lockRevision) {
      if (currentLock === lockRevision) vault.lock();
      return false;
    }
    // A change event during the restore was dropped, since only unlocked windows follow them.
    const latest = entryEvents !== events ? latestEntry : entry;
    if (entry.sessionId !== vault.sessionId || latest.sessionId !== vault.sessionId) {
      // Another window unlocked again meanwhile: this window follows that unlock instead.
      vault.lock();
      followSoon(50);
      return false;
    }
    const granted = await link.claim(vault.sessionId);
    if (currentLock !== lockRevision) return false;
    if (!granted) {
      refused = true;
      vault.lock();
      return false;
    }
    unlocked = true;
    list.reveal(readRevealed(stored[REVEALED_STORAGE_KEY]));
    list.render(records);
    await list.update();
    return unlocked;
  }

  // Another window unlocked: follow it, once start-up and any unlock attempt here have finished.
  async function follow() {
    clearTimeout(followTimer);
    if (unlocked || disposed || following) return;
    if (!started || auth.busy) {
      followSoon(50);
      return;
    }
    following = true;
    auth.cancel();
    try {
      if (await restore()) await onFollowed();
      // The window that unlocked may not have claimed its unlock yet.
      else if (refused && ++followTries < FOLLOW_TRIES) followSoon(FOLLOW_RETRY_MS);
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
      // This window's own unlock, or a change of its setting, needs nothing. Another window unlocked, again with a
      // password or the recovery key: this window follows that unlock.
      if (entry.newValue.sessionId !== vault.sessionId) {
        if (unlocked) await onEnded(false);
        followTries = 0;
        follow();
      }
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
    clearTimeout(followTimer);
    vault.lock();
    link.release();
    if (!revoke) return true;
    try {
      await revokeUnlock(storage);
      return true;
    } catch { return false; }
  }

  function dispose() {
    disposed = true;
    // The background script sees the port close: it ends an unlock that ends with the popup, or starts its timer.
    link.close();
    clearTimeout(followTimer);
    browser.storage.onChanged.removeListener(changed);
    vault.lock();
  }

  browser.storage.onChanged.addListener(changed);
  return {
    restore, show, lock, dispose,
    // After a password, the recovery key or a new vault: the unlock remember() has just stored is handed off to this
    // window, which asks to hold it. Resolves to false when the background script refused.
    claim: () => link.claim(vault.sessionId),
    begin() { unlocked = true; },
    // The Add code window that this popup opens next may take over the unlock, also one that ends with the popup.
    handOff: () => link.handOff('add'),
    // The Add code window was open already.
    cancelHandOff: () => link.cancelHandOff('add'),
    // Start-up has finished: unlocks made in other windows are followed from now on.
    ready() { started = true; },
    get unlocked() { return unlocked; },
    get windowId() { return link.windowId; },
  };
}
