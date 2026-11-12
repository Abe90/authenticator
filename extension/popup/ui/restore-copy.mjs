import { element } from './dom.mjs';
import { formError, onSubmit, pageAction } from './forms.mjs';
import { WRONG_PASSWORD, failureText } from './messages.mjs';
import { plural, t } from '../../shared/i18n.mjs';

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// A vault that left Firefox Sync, from the copy this computer kept of it (core/vault-copy.mjs), in two pages like
// another vault's codes: its password or recovery key, then its codes. Only the second page's buttons change
// anything: one puts the vault back in Firefox Sync with the chosen codes, the other deletes the copy, at a second
// press. The copy may be old: a password changed since opens it, and works again once it is restored. The back arrow
// and Escape go back to where it started (onExit); onDone() runs once the vault is back.
export function createRestoreCopy({ copy, views, onDone, onExit }) {
  const description = element('#restore-description');
  const openForm = element('#restore-open-form');
  const password = element('#restore-password');
  const keyInput = element('#restore-key');
  const useKey = element('#restore-use-key');
  const openButton = element('#restore-continue');
  const openError = formError(openForm, element('#restore-open-error'));
  const codesForm = element('#restore-codes-form');
  const title = element('#restore-codes-title');
  const list = element('#restore-accounts');
  const note = element('#restore-codes-note');
  const submit = element('#restore-submit');
  const discard = element('#restore-discard');
  const codesError = formError(codesForm, element('#restore-codes-error'));
  const action = pageAction();
  let vaultId = null;
  let withKey = false;
  let choices = [];
  let confirming = false;
  // Bumped by reset(), so that a read of the copy still running is dropped.
  let revision = 0;
  const secret = () => (withKey ? keyInput : password);
  // A page still sliding in would ignore the move to the next one, which the field's reset would then lose.
  async function settled() {
    while (views.changing) await new Promise((done) => { setTimeout(done, 50); });
  }

  const selected = () => choices.filter(({ checkbox }) => checkbox.checked && !checkbox.disabled)
    .map(({ id }) => id);
  function count() {
    const chosen = selected().length;
    submit.textContent = chosen ? plural('restoreCodes', chosen) : t('restoreVault');
  }

  function render(opened) {
    title.textContent = plural('codeCount', opened.accounts.length);
    choices = opened.accounts.map(({ id, name, inSync }) => {
      const label = document.createElement('label');
      label.className = 'migration-account';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !inSync;
      checkbox.disabled = inSync;
      checkbox.addEventListener('change', count);
      const text = document.createElement('span');
      text.textContent = name;
      if (inSync) {
        const small = document.createElement('small');
        small.className = 'duplicate';
        small.textContent = t('alreadyInSync');
        text.append(small);
      }
      label.append(checkbox, text);
      return { label, checkbox, id };
    });
    list.replaceChildren(...choices.map(({ label }) => label));
    const notes = [];
    if (opened.damaged) notes.push(plural('copyDamaged', opened.damaged));
    if (opened.replaces) notes.push(t('becomesMain'));
    note.textContent = notes.join(' ');
    note.hidden = !notes.length;
    count();
  }

  function useSecret(key) {
    withKey = key;
    openForm.reset();
    password.closest('.password-field').hidden = withKey;
    keyInput.hidden = !withKey;
    useKey.textContent = withKey ? t('usePasswordInstead') : t('useKeyInstead');
    openError.clear();
  }

  function confirmDiscard(on) {
    confirming = on;
    discard.textContent = on ? t('deleteForGood') : t('deleteCopy');
  }

  // Forgets the password or key typed, the codes and the choices: at the end, the exit and a lock.
  function reset() {
    revision++;
    vaultId = null;
    openForm.reset();
    openError.clear();
    codesError.clear();
    choices = [];
    list.replaceChildren();
    confirmDiscard(false);
  }

  useKey.addEventListener('click', () => {
    useSecret(!withKey);
    secret().focus();
  });
  onSubmit(openForm, async () => {
    const current = revision;
    const opened = await action.run(openButton, () => copy.open(withKey ? 'recovery' : 'password', secret().value),
      (error) => {
        if (error.reason === 'not-found') openError.show(t('copyGone'));
        else openError.show(withKey ? t('keyNotCopy') : WRONG_PASSWORD, secret());
        secret().focus();
      });
    if (!opened || current !== revision) return;
    // Used: the field keeps no copy.
    openForm.reset();
    vaultId = opened.vaultId;
    render(opened);
    codesError.clear();
    confirmDiscard(false);
    await settled();
    await views.navigate('restore-codes');
  });
  onSubmit(codesForm, async () => {
    const chosen = selected();
    const done = await action.run(submit, async () => {
      await copy.restore(vaultId, chosen);
      return true;
    }, (error) => codesError.show(error.reason === 'exists'
      ? t('vaultIsBack')
      : failureText(error, t('restoreFailed'))));
    if (!done) return;
    reset();
    await onDone();
  });
  discard.addEventListener('click', async () => {
    if (action.busy) return;
    if (!confirming) {
      confirmDiscard(true);
      return;
    }
    const done = await action.run(discard, async () => {
      await copy.discard(vaultId);
      return true;
    }, () => codesError.show(t('deleteCopyFailed')));
    if (!done) return;
    reset();
    await onExit();
  });

  return {
    async start() {
      reset();
      useSecret(false);
      const [first] = await copy.kept();
      description.textContent = first?.at
        ? t('restoreDescriptionDated', day.format(first.at))
        : t('restoreDescription');
      await views.navigate('restore-open');
    },
    async back() {
      if (action.busy) return;
      reset();
      await onExit();
    },
    reset,
    get busy() { return action.busy; },
  };
}
