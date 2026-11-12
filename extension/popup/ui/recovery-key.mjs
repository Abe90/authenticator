import { element } from './dom.mjs';
import { formError, onSubmit, pageAction } from './forms.mjs';
import { failureText } from './messages.mjs';
import { createRecoveryKey, parseRecoveryKey } from '../../core/vault-crypto.mjs';

// The recovery key a popup that closed kept, or a new one.
export function keptOrNewKey(state) {
  try {
    parseRecoveryKey(state?.key).fill(0);
    return state.key;
  } catch { return createRecoveryKey(); }
}

// A recovery key on two lines of four groups each; Copy takes it whole, and shows a tick for a moment. show(key)
// sets the key, clear() forgets it.
export function recoveryKeyView(output, copy) {
  const icon = copy.querySelector('.icon');
  let key = '';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(key); } catch { return; }
    icon.className = 'icon icon-check';
    setTimeout(() => { icon.className = 'icon icon-copy'; }, 1500);
  });
  return {
    show(next) {
      key = next;
      output.textContent = `${key.slice(0, 19)}\n${key.slice(20)}`;
    },
    clear() {
      key = '';
      output.textContent = '';
    },
  };
}

// New recovery key, once the password was checked: the new key, which a popup that closed keeps, and Replace key.
// The old key keeps working until then. onDone() goes back to Settings.
export function createNewRecoveryKey({ vault, store, onDone }) {
  const form = element('#new-key-form');
  const saved = element('#new-key-saved');
  const replace = element('#replace-key');
  const error = formError(form, element('#new-key-error'));
  const keyView = recoveryKeyView(element('#replacement-key'), element('#copy-new-key'));
  const action = pageAction();
  let key = '';
  let password = '';

  saved.addEventListener('change', () => { replace.disabled = !saved.checked; });
  onSubmit(form, async () => {
    if (!saved.checked) return;
    const replaced = await action.run(replace, async () => {
      await vault.replaceRecoveryKey(password, key);
      return true;
    }, (failure) => error.show(failureText(failure, 'Could not replace the key. Please try again.')));
    if (replaced) await store.leave(onDone);
  });

  function resetForm() {
    password = '';
    form.reset();
    error.clear();
    replace.disabled = true;
  }
  // At the end, the exit or a lock: the password and the new key are forgotten too.
  function reset() {
    resetForm();
    key = '';
    keyView.clear();
  }
  return {
    // Before the password is asked: the key kept from a popup that closed, or a new one, kept in turn.
    async prepare(state) {
      reset();
      key = keptOrNewKey(state);
      keyView.show(key);
      await store.save({ run: 'recovery', key });
    },
    // checked: the password, just checked.
    start(checked) {
      resetForm();
      password = checked;
    },
    reset,
    get busy() { return action.busy; },
  };
}
