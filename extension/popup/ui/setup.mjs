import { element } from './dom.mjs';
import { formError, newPasswordProblem, onSubmit, pageAction } from './forms.mjs';
import { keptOrNewKey, recoveryKeyView } from './recovery-key.mjs';

// First setup, when there is no vault, on pages like the others: the choice, then for a new vault its password and
// its recovery key with Create vault, or for the vault of another computer the page Get your codes. Every page after
// the choice has the back arrow at the top. The extension cannot tell whether Firefox Sync is on or has finished, so
// Get your codes waits for nothing: it shows the Firefox buttons that bring the vault. Sync now closes the popup;
// opened again with the vault there, the popup skips the setup and shows the password page, and without it starts
// again from the choice, with a note. Nothing is written before Create vault. onDone(records) runs once the vault is
// open; onVaultArrived() when a vault arrives through Firefox Sync, which the password page then opens.
export function createSetup({ vault, views, store, onDone, onVaultArrived }) {
  const chooseNew = element('#choose-new');
  const chooseOther = element('#choose-other');
  const notice = element('#choice-notice');
  const passwordForm = element('#setup-password-form');
  const password = element('#new-password');
  const confirm = element('#new-confirm');
  const passwordError = formError(passwordForm, element('#setup-password-error'));
  const keyForm = element('#setup-key-form');
  const saved = element('#key-saved');
  const create = element('#create-vault');
  const keyError = formError(keyForm, element('#key-error'));
  const keyView = recoveryKeyView(element('#recovery-key'), element('#copy-key'));
  const action = pageAction();
  let active = false;
  // While this popup writes the new vault, whose arrival is no news.
  let writing = false;
  let key = '';
  let chosen = null;

  const blocked = () => !active || action.busy || views.changing;
  // Kept at every choice, so that a popup that closes goes on from there: the recovery key stays the same.
  const keep = () => store.save({ run: 'setup', key, chosen });
  // Back on the choice, the choice made stays highlighted and focused.
  const focusChoice = () => element(chosen === 'other' ? '#choose-other' : '#choose-new')
    .focus({ preventScroll: true, focusVisible: false });

  function highlight() {
    chooseNew.classList.toggle('selected', chosen === 'new');
    chooseOther.classList.toggle('selected', chosen === 'other');
  }

  // A choice moves on at once.
  async function choose(name) {
    if (blocked()) return;
    chosen = name;
    highlight();
    await keep();
    await views.navigate(name === 'other' ? 'get-codes' : 'setup-password');
  }
  chooseNew.addEventListener('click', () => choose('new'));
  chooseOther.addEventListener('click', () => choose('other'));

  async function look() {
    if (!active || writing || !(await vault.exists().catch(() => false)) || !active || writing) return;
    onVaultArrived();
  }
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'sync') look(); });

  onSubmit(passwordForm, () => {
    if (blocked()) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) passwordError.show(...problem);
    else views.navigate('setup-key');
  });
  saved.addEventListener('change', () => { create.disabled = !saved.checked; });
  onSubmit(keyForm, async () => {
    if (blocked() || !saved.checked) return;
    const records = await action.run(create, () => {
      writing = true;
      return vault.create(password.value, key);
    }, (error) => {
      writing = false;
      keyError.show(error.reason === 'exists'
        ? 'A vault arrived from Firefox Sync meanwhile. Go back and unlock it instead.'
        : 'Could not create the vault. Please try again.');
    });
    create.disabled = !saved.checked;
    if (records) {
      stop();
      await store.leave(onDone, records);
    }
  });

  function stop() {
    active = false;
  }

  return {
    // state: what a popup that closed kept. A new vault goes on from its password, which is not kept; a popup closed
    // on Get your codes, as Sync now does, opens again on the choice with a note.
    async start(state) {
      active = true;
      writing = false;
      key = keptOrNewKey(state);
      chosen = ['new', 'other'].includes(state?.chosen) ? state.chosen : null;
      passwordForm.reset();
      keyForm.reset();
      passwordError.clear();
      keyError.clear();
      create.disabled = true;
      keyView.show(key);
      highlight();
      notice.hidden = chosen !== 'other';
      await keep();
      if (chosen === 'new') await views.navigate('setup-password');
      else await views.navigate('setup', focusChoice);
      look();
    },
    // The back arrow and Escape: from the recovery key to the password, from the other pages to the choice.
    async back() {
      if (blocked()) return;
      if (views.current === 'setup-key') await views.navigate('setup-password');
      else await views.navigate('setup', focusChoice);
    },
    stop,
    get busy() { return action.busy; },
  };
}
