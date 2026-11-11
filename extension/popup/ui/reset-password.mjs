import { element } from './dom.mjs';
import { createPasswordEntry } from './password-entry.mjs';

const NOT_A_KEY = 'This is not a recovery key: it has 32 letters and digits.';
const WRONG_KEY = 'This recovery key does not open this vault. Check it and try again.';

// Forgot password, in two pages like Change password: the recovery key, on a page like the password page and checked
// on its own once typing pauses, then the new password page, whose Reset password is the only step that changes the
// vault. The back arrow and Escape on either page go back to the password page (onExit). A popup that closes on the
// way opens again on the recovery key, typed again as passwords are. onDone(records) runs once the vault is open.
export function createReset({ vault, views, store, newPassword, blocked, onDone, onExit }) {
  const input = element('#reset-key');
  const active = () => views.current === 'reset';
  const entry = createPasswordEntry({
    form: element('#reset-form'),
    input,
    submit: element('#reset-submit'),
    error: element('#reset-key-error'),
    label: 'Continue',
    busyLabel: 'Checking…',
    active,
    blocked,
    async attempt(key, { automatic, stale, fail }) {
      try {
        await vault.checkRecoveryKey(key);
      } catch (error) {
        if (!automatic) fail(error.reason === 'not-recovery-key' ? NOT_A_KEY : WRONG_KEY, input);
        return;
      }
      if (stale() || !active()) return;
      newPassword.start({
        label: 'Reset password',
        backLabel: 'Back to the password page',
        save: (password) => vault.resetPassword(key, password),
        failure: 'Could not reset the password. Please try again.',
        done: (records) => store.leave(onDone, records),
        back: exit,
      });
      await views.navigate('password');
      // Handed over to the next page: the field keeps no copy.
      if (!active()) entry.cancel();
    },
  });

  async function exit() {
    if (entry.busy || newPassword.busy) return;
    entry.reset();
    newPassword.reset();
    await store.leave(onExit);
  }

  return {
    async start() {
      entry.reset();
      newPassword.reset();
      await store.save({ run: 'reset' });
      await views.navigate('reset');
    },
    back: exit,
  };
}
