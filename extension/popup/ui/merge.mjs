import { element } from './dom.mjs';
import { formError, onSubmit, pageAction } from './forms.mjs';
import { WRONG_PASSWORD, failureText, plural } from './messages.mjs';
import { duplicateReasons } from '../../core/duplicates.mjs';

// The codes of another vault, made on a computer before it was connected to Firefox Sync, in two pages like the
// password page: its password or recovery key, then its codes with the duplicates marked. Only the second page's
// button changes anything: it adds the chosen codes and removes that vault, or with none chosen only removes it. The
// back arrow and Escape on either page go back to where it started (onExit). A popup that closes on the way opens
// again on the first page, where the password or key is typed again.
export function createMerge({ vault, views, store, onDone, onExit }) {
  const openForm = element('#merge-open-form');
  const password = element('#merge-password');
  const keyInput = element('#merge-key');
  const description = element('#merge-description');
  const useKey = element('#merge-use-key');
  const openButton = element('#merge-continue');
  const openError = formError(openForm, element('#merge-open-error'));
  const codesForm = element('#merge-codes-form');
  const title = element('#merge-codes-title');
  const list = element('#merge-accounts');
  const add = element('#merge-add');
  const codesError = formError(codesForm, element('#merge-codes-error'));
  const action = pageAction();
  let vaultId = null;
  let withKey = false;
  let choices = [];
  const secret = () => (withKey ? keyInput : password);

  const selected = () => choices.filter(({ checkbox, record }) => checkbox.checked && record)
    .map(({ record }) => record);
  function count() {
    const chosen = selected().length;
    add.textContent = chosen ? `Add ${plural(chosen, 'code')}` : 'Remove that vault';
  }

  function render(records, reasons) {
    title.textContent = plural(records.length, 'code');
    choices = records.map((record, index) => {
      const reason = reasons[index];
      const label = document.createElement('label');
      label.className = 'migration-account';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !reason;
      checkbox.disabled = Boolean(reason);
      checkbox.addEventListener('change', count);
      const text = document.createElement('span');
      text.textContent = record.name;
      if (reason) {
        const note = document.createElement('small');
        note.className = 'duplicate';
        note.textContent = reason;
        text.append(note);
      }
      label.append(checkbox, text);
      return { label, checkbox, record: reason ? null : record };
    });
    list.replaceChildren(...choices.map(({ label }) => label));
    count();
  }

  // The password of the other vault, or its recovery key instead.
  function useSecret(key) {
    withKey = key;
    openForm.reset();
    password.closest('.password-field').hidden = withKey;
    keyInput.hidden = !withKey;
    description.textContent = withKey
      ? 'Enter the recovery key that was saved when the other vault was created.'
      : 'Enter the password you chose for it on the other computer.';
    useKey.textContent = withKey ? 'Use its password instead' : 'Use its recovery key instead';
    openError.clear();
  }

  useKey.addEventListener('click', () => {
    useSecret(!withKey);
    secret().focus();
  });
  onSubmit(openForm, async () => {
    const opened = await action.run(openButton, async () => {
      const records = withKey
        ? await vault.openOtherWithRecoveryKey(vaultId, keyInput.value)
        : await vault.openOther(vaultId, password.value);
      const entries = records.map((record) => ({ name: record.name, record }));
      return { records, reasons: duplicateReasons(entries, await vault.read()) };
    }, (error) => {
      if (error.reason === 'not-found') openError.show('That vault is no longer there.');
      else openError.show(withKey ? 'This recovery key does not open that vault.' : WRONG_PASSWORD, secret());
      secret().focus();
    });
    if (!opened) return;
    render(opened.records, opened.reasons);
    codesError.clear();
    await views.navigate('merge-codes');
  });
  onSubmit(codesForm, async () => {
    const chosen = selected();
    const done = await action.run(add, async () => {
      if (chosen.length) await vault.mergeOther(vaultId, chosen);
      else await vault.removeOther(vaultId);
      return true;
    }, (error) => codesError.show(failureText(error, 'Could not add the codes. Please try again.')));
    if (done) await store.leave(onDone);
  });

  return {
    async start(state) {
      vaultId = state.vaultId;
      useSecret(false);
      codesError.clear();
      list.replaceChildren();
      await store.save({ run: 'merge', vaultId });
      await views.navigate('merge-open');
    },
    async back() {
      if (!action.busy) await store.leave(onExit);
    },
    get busy() { return action.busy; },
  };
}
