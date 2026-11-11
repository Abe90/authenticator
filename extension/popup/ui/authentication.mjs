import { element } from './dom.mjs';
import { createPasswordEntry } from './password-entry.mjs';

// The password page, which unlocks the vault; Forgot password? starts the reset with the recovery key (onForgot).
export function createAuthentication({ vault, active, blocked, remember, onUnlocked, onForgot }) {
  const authForm = element('#auth-form');
  const passwordInput = element('#vault-password');
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
          vault.lock();
          await vault.forget();
          return;
        }
        authForm.reset();
        await onUnlocked(records);
      } catch {
        if (verified) vault.lock();
        if (verified) fail('Could not save the unlock session. Please try again.');
        else if (!automatic) fail('Incorrect password or damaged vault. Please try again.', passwordInput);
      }
    },
  });
  element('#forgot-password').addEventListener('click', () => {
    if (!entry.busy && !blocked() && active()) onForgot();
  });

  return {
    configure() {
      entry.reset();
      element('#auth-title').textContent = 'Unlock your codes';
      element('#auth-description').textContent = 'Enter your password to open your encrypted vault.';
    },
    cancel: entry.cancel,
    focus: entry.focus,
    showError: entry.showError,
    get busy() { return entry.busy; },
  };
}
