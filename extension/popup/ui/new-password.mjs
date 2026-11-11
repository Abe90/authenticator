import { element } from './dom.mjs';
import { formError, newPasswordProblem, onSubmit, pageAction } from './forms.mjs';
import { failureText } from './messages.mjs';

// The page that takes a new password and its confirmation, after Change password checked the password and after
// Forgot password checked the recovery key. start() sets it up for one of them: label for its button, backLabel for
// its back arrow, save(password) that changes the vault, failure for a save that fails, done(saved) once saved, and
// back() for the back arrow and Escape.
export function createNewPassword() {
  const form = element('#password-form');
  const password = element('#password-new');
  const confirm = element('#password-confirm');
  const error = formError(form, element('#password-error'));
  const button = element('#password-save');
  const backButton = element('#password-back');
  const action = pageAction();
  let use = null;

  function showError(text, field) {
    error.show(text, field);
    field?.focus();
  }
  function reset() {
    use = null;
    form.reset();
    error.clear();
  }
  onSubmit(form, async () => {
    if (action.busy || !use) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      showError(...problem);
      return;
    }
    const { save, failure, done } = use;
    const saved = await action.run(button, () => save(password.value),
      (caught) => showError(failureText(caught, failure)));
    if (!saved) return;
    reset();
    await done(saved);
  });
  return {
    start(next) {
      reset();
      use = next;
      button.textContent = next.label;
      backButton.setAttribute('aria-label', next.backLabel);
    },
    back: () => use?.back(),
    reset,
    get busy() { return action.busy; },
  };
}
