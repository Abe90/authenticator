import { element, message } from './dom.mjs';
import { pageAction } from './forms.mjs';
import { plural } from './messages.mjs';
import { AFTER_UNLOCK_KEY } from '../../core/storage-keys.mjs';
import { duplicateGroups } from '../../core/duplicates.mjs';

const added = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const damagedMessage = (count) => (count === 1
  ? 'One code in your vault is damaged and can’t be shown. The others work as usual.'
  : `${count} codes in your vault are damaged and can’t be shown. The others work as usual.`);

// Once after an unlock with a password or the recovery key, the toolbar popup looks in turn for another vault, a key
// added on two computers and damaged accounts, and offers each on its page before the list. Not now leaves it for
// the next unlock. onMerge(vaultId) opens the window that adds another vault's codes; onDone() returns to the list.
export function createAfterUnlock({ vault, views, notice, onMerge, onDone, onError }) {
  const storage = browser.storage.session;
  const otherDescription = element('#other-description');
  const removeMessage = element('#remove-vault-message');
  const removeError = element('#remove-vault-error');
  const removeConfirm = element('#remove-vault-confirm');
  const choices = element('#duplicates-choices');
  const duplicatesError = element('#duplicates-error');
  const keep = element('#duplicates-keep');
  let queue = [];
  let other = null;
  let groups = [];
  const action = pageAction();
  // Bumped by every clear, so work started before a lock no longer opens a page.
  let revision = 0;

  async function step(current) {
    while (queue.length && current === revision) {
      const check = queue.shift();
      if (check === 'other') {
        [other] = await vault.others();
        if (other && current === revision) {
          const codes = plural(other.codes, 'code');
          otherDescription.textContent = `One of your computers made a separate vault with ${codes} before it was `
            + 'connected to Firefox Sync.';
          await views.navigate('other');
          return;
        }
      } else if (check === 'duplicates') {
        groups = duplicateGroups(await vault.read());
        if (groups.length && current === revision) {
          await showGroup();
          return;
        }
      } else if (vault.damaged && current === revision) {
        // From the list, so that Close returns there.
        await onDone();
        notice.show('Some codes can’t be read', damagedMessage(vault.damaged));
        return;
      }
    }
    if (current === revision) await onDone();
  }

  function next() {
    step(revision).catch(() => onDone());
  }

  // Starts the checks when an unlock asked for them; false when there are none to run.
  async function run() {
    const current = revision;
    const { [AFTER_UNLOCK_KEY]: due } = await storage.get(AFTER_UNLOCK_KEY);
    if (!due || current !== revision) return false;
    await storage.remove(AFTER_UNLOCK_KEY);
    queue = ['other', 'duplicates', 'damaged'];
    await step(current);
    return true;
  }

  async function showGroup() {
    message(duplicatesError);
    choices.replaceChildren(...groups[0].map((account, index) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const text = document.createElement('span');
      text.className = 'choice-text';
      const name = document.createElement('span');
      name.className = 'choice-title';
      name.textContent = account.name;
      const date = document.createElement('span');
      date.className = 'choice-hint';
      date.textContent = `Added ${added.format(account.added)}`;
      text.append(name, date);
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'keep';
      radio.value = account.id;
      radio.checked = index === 0;
      label.append(text, radio);
      return label;
    }));
    if (views.current === 'duplicates') choices.querySelector('input').focus();
    else await views.navigate('duplicates');
  }

  async function keepChosen() {
    const id = choices.querySelector('input:checked')?.value;
    if (!id) return;
    const kept = await action.run(keep, async () => {
      await vault.keepDuplicate(id);
      groups.shift();
      return true;
    }, () => message(duplicatesError, 'Could not remove the other entry. Please try again.'));
    if (!kept) return;
    if (groups.length) await showGroup();
    else next();
  }

  async function removeOther() {
    if (!other) return;
    const removed = await action.run(removeConfirm, async () => {
      message(removeError);
      await vault.removeOther(other.id);
      return true;
    }, () => message(removeError, 'Could not remove the vault. Please try again.'));
    if (removed) next();
  }

  element('#other-add').addEventListener('click', () => { if (!action.busy && other) onMerge(other.id); });
  element('#other-later').addEventListener('click', () => { if (!action.busy) next(); });
  element('#other-remove').addEventListener('click', () => {
    if (action.busy || !other) return;
    const codes = plural(other.codes, 'code');
    removeMessage.textContent = `Its ${codes} will be deleted on all your computers without being opened. `
      + 'The codes in your vault are not affected.';
    message(removeError);
    views.navigate('remove-vault');
  });
  element('#remove-vault-cancel').addEventListener('click', () => { if (!action.busy) views.navigate('other'); });
  removeConfirm.addEventListener('click', removeOther);
  element('#duplicates-panel').addEventListener('submit', (event) => {
    event.preventDefault();
    keepChosen().catch(onError);
  });
  element('#duplicates-later').addEventListener('click', () => {
    if (action.busy) return;
    queue = queue.filter((check) => check !== 'duplicates');
    next();
  });

  return {
    run,
    // Back from adding another vault's codes: its page again, or the list once it is gone.
    async reopen() {
      if (other) await views.navigate('other');
      else await onDone();
    },
    // Back from a page: Not now, or from the removal back to the other vault.
    back() {
      if (action.busy) return;
      if (views.current === 'remove-vault') views.navigate('other');
      else next();
    },
    clear() {
      revision++;
      queue = [];
      other = null;
      groups = [];
    },
    get busy() { return action.busy; },
  };
}
