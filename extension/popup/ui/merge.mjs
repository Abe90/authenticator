import { element } from './dom.mjs';
import { formError, onSubmit, pageAction } from './forms.mjs';
import { WRONG_PASSWORD, failureText, plural } from './messages.mjs';
import { copyChoices } from '../../core/duplicates.mjs';

// The codes of another vault, made on a computer before it was connected to Firefox Sync, in two pages like the
// password page: its password or recovery key, then its codes with the duplicates marked and the number that do not
// open. Only the second page's button changes anything: it copies the chosen codes into the main vault and leaves the
// other vault as it is, which a receipt on this computer then stops offering (receipts). If the other vault changed
// since its codes were read, they are read again for a new choice. The back arrow and Escape on either page go back
// to where it started (onExit). A popup that closes on the way opens again on the first page, where the password or
// key is typed again.
export function createMerge({ vault, views, store, receipts, onDone, onExit }) {
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
  const damagedNote = element('#merge-damaged');
  const add = element('#merge-add');
  const codesError = formError(codesForm, element('#merge-codes-error'));
  const action = pageAction();
  let vaultId = null;
  let withKey = false;
  let choices = [];
  // What was read of the other vault: its accounts, the number that do not open, its snapshot and reload().
  let opened = null;
  // Bumped by reset(), so that a read of the other vault still running is dropped.
  let revision = 0;
  const secret = () => (withKey ? keyInput : password);

  const selected = () => choices.filter(({ checkbox, record }) => checkbox.checked && record)
    .map(({ record }) => record);
  function count() {
    const chosen = selected().length;
    add.textContent = chosen ? `Copy ${plural(chosen, 'code')}` : 'Copy codes';
    add.disabled = !chosen;
  }

  async function render(read) {
    opened = read;
    const reasons = copyChoices(read.accounts, await vault.read());
    title.textContent = plural(read.accounts.length, 'code');
    choices = read.accounts.map((record, index) => {
      const { skip, note } = reasons[index];
      const label = document.createElement('label');
      label.className = 'migration-account';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !skip;
      checkbox.disabled = Boolean(skip);
      checkbox.addEventListener('change', count);
      const text = document.createElement('span');
      text.textContent = record.name;
      if (skip || note) {
        const small = document.createElement('small');
        small.className = 'duplicate';
        small.textContent = skip ?? note;
        text.append(small);
      }
      label.append(checkbox, text);
      return { label, checkbox, record: skip ? null : record };
    });
    list.replaceChildren(...choices.map(({ label }) => label));
    damagedNote.hidden = !read.damaged;
    damagedNote.textContent = `${plural(read.damaged, 'code')} of the other vault can’t be opened. They stay in it.`;
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

  // Forgets the other vault's password or key, its codes and the choices: at the end, the exit and a lock.
  function reset() {
    revision++;
    opened = null;
    openForm.reset();
    openError.clear();
    codesError.clear();
    choices = [];
    list.replaceChildren();
  }

  useKey.addEventListener('click', () => {
    useSecret(!withKey);
    secret().focus();
  });
  onSubmit(openForm, async () => {
    const current = revision;
    const read = await action.run(openButton, () => (withKey
      ? vault.openOtherWithRecoveryKey(vaultId, keyInput.value)
      : vault.openOther(vaultId, password.value)), (error) => {
      if (error.reason === 'not-found') openError.show('That vault is no longer there.');
      else openError.show(withKey ? 'This recovery key does not open that vault.' : WRONG_PASSWORD, secret());
      secret().focus();
    });
    if (!read || current !== revision) return;
    // Used: the field keeps no copy.
    openForm.reset();
    await render(read);
    if (current !== revision) return;
    codesError.clear();
    while (views.changing) await new Promise((done) => { setTimeout(done, 50); });
    await views.navigate('merge-codes');
  });
  onSubmit(codesForm, async () => {
    const chosen = selected();
    if (!chosen.length || !opened) return;
    const current = revision;
    let changed = false;
    const done = await action.run(add, async () => {
      const { added } = await vault.copyFromOther(vaultId, chosen, opened.snapshot);
      await receipts.save(vaultId, {
        target: vault.vaultId, snapshot: opened.snapshot, added,
        skipped: opened.accounts.length - chosen.length, unreadable: opened.damaged,
      }).catch(() => {});
      return true;
    }, (error) => {
      changed = error.reason === 'changed';
      codesError.show(changed
        ? 'The other vault changed meanwhile. Check the codes again.'
        : failureText(error, 'Could not copy the codes. Please try again.'));
    });
    if (changed && current === revision) {
      const read = await opened.reload().catch(() => null);
      if (read && current === revision) await render(read);
      return;
    }
    count();
    if (!done) return;
    reset();
    await store.leave(onDone);
  });

  return {
    async start(state) {
      vaultId = state.vaultId;
      reset();
      useSecret(false);
      await store.save({ run: 'merge', vaultId });
      await views.navigate('merge-open');
    },
    async back() {
      if (action.busy) return;
      reset();
      await store.leave(onExit);
    },
    reset,
    get busy() { return action.busy; },
  };
}
