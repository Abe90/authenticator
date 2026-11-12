import { t } from '../../shared/i18n.mjs';
import { element } from './dom.mjs';
import { createPasswordEntry } from './password-entry.mjs';

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
    label: t('continue'),
    busyLabel: t('checking'),
    active,
    blocked,
    async attempt(key, { automatic, stale, fail }) {
      try {
        await vault.checkRecoveryKey(key);
      } catch (error) {
        if (!automatic) fail(error.reason === 'not-recovery-key' ? t('notAKey') : t('wrongKey'), input);
        return;
      }
      if (stale() || !active()) return;
      newPassword.start({
        label: t('resetPassword'),
        backLabel: t('backToPassword'),
        save: (password) => vault.resetPassword(key, password),
        failure: t('resetFailed'),
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
