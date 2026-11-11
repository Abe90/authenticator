import { element } from './dom.mjs';
import { WRONG_PASSWORD } from './messages.mjs';
import { createPasswordEntry } from './password-entry.mjs';

// The password asked before Change password and New recovery key, on a page like the password page and with the
// same behaviour: the password is checked on its own once typing pauses. show() sets the page up for one of them;
// onChecked(password) runs once the password is right.
export function createPasswordCheck({ vault, active, blocked }) {
  const input = element('#verify-password');
  let checked = null;
  const entry = createPasswordEntry({
    form: element('#verify-form'),
    input,
    submit: element('#verify-submit'),
    error: element('#verify-error'),
    label: 'Continue',
    busyLabel: 'Checking…',
    active,
    blocked,
    async attempt(password, { automatic, stale, fail }) {
      try {
        await vault.checkPassword(password);
      } catch {
        if (!automatic) fail(WRONG_PASSWORD, input);
        return;
      }
      if (stale() || !active()) return;
      await checked?.(password);
      // Handed over to the next page: the field keeps no copy.
      if (!active()) entry.cancel();
    },
  });

  return {
    show({ title, description, onChecked }) {
      entry.reset();
      element('#verify-title').textContent = title;
      element('#verify-description').textContent = description;
      checked = onChecked;
    },
    reset() {
      entry.reset();
      checked = null;
    },
    get busy() { return entry.busy; },
  };
}
