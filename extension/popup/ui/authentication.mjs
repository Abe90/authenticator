import { element } from './dom.mjs';
import { createPasswordEntry } from './password-entry.mjs';
import { plural } from './messages.mjs';

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// What the password page says when the password opens a vault that it cannot unlock (core/recovery.mjs).
function explain(found) {
  if (found.newer) {
    return 'A newer version of Authenticator saved your vault. Update the extension to open it. Until then you can '
      + 'see your codes, read-only.';
  }
  if (found.reason === 'changed') {
    return 'This password opened your vault on this computer, but the vault in Firefox Sync has changed since: its '
      + 'password may have changed on another computer, or it is damaged. You can see your codes, read-only.';
  }
  if (found.reason === 'missing') {
    return 'This password opened your vault on this computer, but the vault is no longer complete in Firefox Sync. '
      + 'You can see your codes, read-only.';
  }
  if (found.reason === 'unreadable') {
    return 'Your vault in Firefox Sync is damaged. This password opened it on this computer: you can see your codes, '
      + 'read-only.';
  }
  return `This password does not open the main vault in Firefox Sync, but another vault, created on `
    + `${day.format(found.created)}, with ${plural(found.codes, 'code')}. You can see its codes, read-only.`;
}

// The password page, which unlocks the vault; Forgot password? starts the reset with the recovery key (onForgot).
// remember() stores the unlock. A password that
// does not unlock is tried, at a submit only, for a read-only recovery (recovery.find), which Show codes read-only
// opens (onRecover).
export function createAuthentication({ vault, recovery, active, blocked, remember, onUnlocked, onForgot, onRecover }) {
  const authForm = element('#auth-form');
  const passwordInput = element('#vault-password');
  const recoverButton = element('#auth-recover');
  // What the password typed opens for the recovery, until it changes.
  let found = null;
  function offer(next) {
    found = next;
    recoverButton.hidden = !next;
  }
  passwordInput.addEventListener('input', () => offer(null));
  const entry = createPasswordEntry({
    form: authForm,
    input: passwordInput,
    submit: element('#auth-submit'),
    error: element('#auth-error'),
    label: 'Unlock',
    busyLabel: 'Unlocking…',
    active,
    blocked,
    async attempt(password, { automatic, stale, fail }) {
      let verified = false;
      try {
        const records = await vault.unlock(password);
        if (stale()) {
          vault.lock();
          return;
        }
        verified = true;
        await remember();
        if (stale()) {
          const { sessionId } = vault;
          vault.lock();
          await vault.forget(sessionId);
          return;
        }
        authForm.reset();
        await onUnlocked(records);
      } catch {
        if (verified) {
          // An unlock stored before the failure is no use to the other windows.
          const { sessionId } = vault;
          vault.lock();
          vault.forget(sessionId).catch(() => {});
          fail('Could not save the unlock session. Please try again.');
        } else if (!automatic) {
          const opened = await recovery.find(password).catch(() => null);
          if (stale()) return;
          if (opened) {
            offer(opened);
            fail(explain(opened), passwordInput);
          } else if (await recovery.newerVault().catch(() => false)) {
            fail('Firefox Sync has a vault saved by a newer version of Authenticator. Update the extension to open '
              + 'it.', passwordInput);
          } else fail('Incorrect password or damaged vault. Please try again.', passwordInput);
        }
      }
    },
  });
  recoverButton.addEventListener('click', () => {
    if (!found || entry.busy || blocked() || !active()) return;
    const opened = found;
    offer(null);
    entry.reset();
    onRecover(opened);
  });
  element('#forgot-password').addEventListener('click', () => {
    if (!entry.busy && !blocked() && active()) onForgot();
  });

  return {
    configure() {
      offer(null);
      entry.reset();
      element('#auth-title').textContent = 'Unlock your codes';
      element('#auth-description').textContent = 'Enter your password to open your encrypted vault.';
    },
    cancel() {
      offer(null);
      entry.cancel();
    },
    focus: entry.focus,
    showError: entry.showError,
    get busy() { return entry.busy; },
  };
}
