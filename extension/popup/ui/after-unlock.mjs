import { element, message } from './dom.mjs';
import { pageAction } from './forms.mjs';
import { plural, t } from '../../shared/i18n.mjs';
import { AFTER_UNLOCK_KEY } from '../../core/storage-keys.mjs';
import { duplicateGroups } from '../../core/duplicates.mjs';

const added = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Once after an unlock with a password or the recovery key, the toolbar popup looks in turn for another vault, a key
// added on two computers, a password too weak for a new one and damaged accounts, and offers each on its page before
// the list. Not now leaves it for the next unlock. Another vault whose copy left a receipt on this computer, and has
// not changed since, is not offered again; Settings opens it all the same (showOther), and Not now returns there
// (onSettings). onMerge(vaultId) opens the pages that copy another vault's codes; onDone() returns to the list.
export function createAfterUnlock({
  vault, views, notice, receipts, onMerge, onDone, onSettings, onError,
}) {
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
  let fromSettings = false;
  const action = pageAction();
  // Bumped by every clear, so work started before a lock no longer opens a page.
  let revision = 0;

  async function step(current) {
    while (queue.length && current === revision) {
      const check = queue.shift();
      if (check === 'other') {
        other = null;
        const ids = (await vault.read()).map((account) => account.id);
        for (const candidate of await vault.others()) {
          if (await receipts.current(candidate, vault.vaultId, ids).catch(() => null)) continue;
          other = candidate;
          break;
        }
        if (other && current === revision) {
          await showOtherPage();
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
        notice.show(t('damagedTitle'), plural('damagedCodes', vault.damaged));
        return;
      }
    }
    if (current === revision) await onDone();
  }

  async function showOtherPage() {
    otherDescription.textContent = plural('otherDescription', other.codes);
    await views.navigate('other');
  }

  function next() {
    if (fromSettings) {
      fromSettings = false;
      onSettings();
      return;
    }
    step(revision).catch(() => onDone());
  }

  // Starts the checks when an unlock asked for them; false when there are none to run.
  async function run() {
    const current = revision;
    const { [AFTER_UNLOCK_KEY]: due } = await storage.get(AFTER_UNLOCK_KEY);
    if (!due || current !== revision) return false;
    await storage.remove(AFTER_UNLOCK_KEY);
    fromSettings = false;
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
      date.textContent = t('addedOn', added.format(account.added));
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
    }, () => message(duplicatesError, t('removeEntryFailed')));
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
    }, () => message(removeError, t('removeVaultFailed')));
    if (removed) next();
  }

  element('#other-add').addEventListener('click', () => { if (!action.busy && other) onMerge(other.id); });
  element('#other-later').addEventListener('click', () => { if (!action.busy) next(); });
  // The second step of removing it says what it still holds that was not copied here.
  element('#other-remove').addEventListener('click', async () => {
    if (action.busy || !other) return;
    const ids = await vault.read().then((accounts) => accounts.map((account) => account.id), () => []);
    const receipt = await receipts.current(other, vault.vaultId, ids).catch(() => null);
    removeMessage.textContent = receipt
      ? plural('removeVaultCopied', other.codes, receipt.added.length, receipt.skipped, receipt.unreadable)
      : plural('removeVaultNotCopied', other.codes);
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
    // From Settings: the first other vault, copied before or not.
    async showOther() {
      if (action.busy) return;
      [other] = await vault.others();
      if (!other) return;
      fromSettings = true;
      await showOtherPage();
    },
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
