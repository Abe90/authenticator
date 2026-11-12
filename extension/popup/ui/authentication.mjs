import { element } from './dom.mjs';
import { createPasswordEntry } from './password-entry.mjs';
import { plural, t } from '../../shared/i18n.mjs';

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// What the password page says when the password opens a vault that it cannot unlock (core/recovery.mjs).
function explain(found) {
  if (found.newer) return t('explainNewer');
  if (found.reason === 'changed') return t('explainChanged');
  if (found.reason === 'missing') return t('explainMissing');
  if (found.reason === 'unreadable') return t('explainUnreadable');
  return plural('explainOther', found.codes, day.format(found.created));
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
    label: t('unlock'),
    busyLabel: t('unlocking'),
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
          fail(t('unlockSessionFailed'));
        } else if (!automatic) {
          const opened = await recovery.find(password).catch(() => null);
          if (stale()) return;
          if (opened) {
            offer(opened);
            fail(explain(opened), passwordInput);
          } else if (await recovery.newerVault().catch(() => false)) {
            fail(t('newerVault'), passwordInput);
          } else fail(t('wrongPasswordOrDamaged'), passwordInput);
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
      element('#auth-title').textContent = t('unlockTitle');
      element('#auth-description').textContent = t('authDescription');
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
