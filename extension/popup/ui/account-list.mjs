import { MAX_COUNTER } from '../../core/limits.mjs';
import { searchQuery, searchText } from '../../core/search.mjs';
import { TOTP_PERIOD, createHotpGenerator, totpStep } from '../../core/totp.mjs';
import { t } from '../../shared/i18n.mjs';
import { createAccountIcon } from './account-icon.mjs';
import { element, moveFocus, reducedMotion } from './dom.mjs';
import { createCountdown } from './countdown.mjs';
import { failureText } from './messages.mjs';
import { createToast } from './toast.mjs';
import { createReorder } from './reorder.mjs';

// HOTP accounts show this until their next-code button is pressed during the current unlock.
const HIDDEN_CODE = '--- ---';
// A new code replacing the shown one (showCode): each digit, from the left, starts DIGIT_STEP_MS after the one before
// it; the old digits take DIGIT_OUT_MS to go, and the new ones start DIGIT_IN_DELAY_MS after the old ones, while those
// are still going, and take DIGIT_IN_MS to come.
const DIGIT_STEP_MS = 40;
const DIGIT_OUT_MS = 120;
const DIGIT_IN_DELAY_MS = 100;
const DIGIT_IN_MS = 300;

// A code as nodes: each digit, or dash, in a box of its own that can be animated, and the space between the groups.
const codeNodes = (text) => [...text].map((character) => {
  if (character === ' ') return document.createTextNode(' ');
  const digit = document.createElement('span');
  digit.className = 'code-digit';
  digit.textContent = character;
  return digit;
});

export function createAccountList({ vault, blocked, onError, onAdvanced, onMenu, onRemove, onRender }) {
  const main = element('main');
  const template = element('.account', main).cloneNode(true);
  const search = element('#search');
  const settings = element('#settings');
  const empty = element('#search-empty');
  const emptyState = element('#empty-state');
  const add = element('#add');
  const emptyMessage = element('#search-empty-message');
  const settingsPanel = element('#settings-panel');
  const listActions = element('#list-actions');
  const countdown = createCountdown();
  const toast = createToast();
  let accounts = [];
  let revision = 0;
  let saving = false;
  let pendingUpdate = null;
  let dirty = false;
  let timer;
  // Cleared by a lock: show nothing, not even the empty state, until the locked view replaces the list.
  let cleared = false;
  // IDs of the HOTP accounts that generated a code during this unlock; a lock empties it.
  const revealed = new Set();
  let lockRevision = 0;
  // Set by a key that opens the context menu, until the menu opens or the pointer is pressed.
  let fromKeyboard = false;
  main.replaceChildren();
  // Firefox stops Tab on a box that scrolls with nothing to focus inside, which the list is once Tab skips its rows.
  main.tabIndex = -1;
  // Reordering waits for other writes, and is off while a search hides some rows.
  const canReorder = () => !saving && !blocked() && accounts.length > 1
    && accounts.every((account) => !account.entry.hidden);
  const reorder = createReorder({
    list: main, rows: () => accounts.map((account) => account.entry), blocked: () => !canReorder(), onDrop: move,
  });

  function filter() {
    const hasText = search.value.length > 0;
    settings.classList.toggle('clear-search', hasText);
    settings.setAttribute('aria-label', hasText ? t('clearSearch') : t('settings'));
    if (hasText) {
      settings.removeAttribute('aria-controls');
      settings.removeAttribute('aria-expanded');
    } else {
      settings.setAttribute('aria-controls', 'settings-panel');
      settings.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    }
    const query = searchQuery(search.value);
    let visible = 0;
    for (const account of accounts) {
      const matches = account.search.includes(query);
      account.entry.hidden = !matches;
      if (matches) visible++;
    }
    emptyState.hidden = Boolean(query);
    emptyMessage.hidden = !query;
    empty.hidden = cleared || visible > 0 || main.hidden;
    listActions.hidden = cleared || main.hidden;
  }

  async function advance(account) {
    if (saving || blocked() || account.counter >= MAX_COUNTER) return;
    // Disabling the focused button can drop keyboard focus, so it is given back once the button is enabled again.
    const focused = document.activeElement === account.next;
    saving = account.pending = true;
    account.next.disabled = true;
    const current = revision;
    const currentLock = lockRevision;
    try {
      const records = await vault.advance(account.id);
      if (currentLock !== lockRevision) return;
      // The stored counter is now that of the new code, which stays visible until the vault locks.
      revealed.add(account.id);
      if (current === revision) {
        account.counter = BigInt(records.find((record) => record.id === account.id).counter);
        await update();
      }
      // If this write fails, the code is only hidden again when the popup reopens.
      try { await onAdvanced(account.id); } catch {}
    } catch (failure) {
      if (current === revision) onError(failureText(failure, t('nextCounterFailed')));
    } finally {
      saving = account.pending = false;
      account.next.disabled = account.counter >= MAX_COUNTER;
      const unclaimed = !document.activeElement || document.activeElement === document.body;
      if (focused && unclaimed && !account.next.disabled && account.next.isConnected) {
        account.next.focus({ preventScroll: true });
      }
    }
  }

  function createAccount(record) {
    const row = template.cloneNode(true);
    row.setAttribute('aria-label', t('copyCodeOf', record.name));
    row.setAttribute('role', 'button');
    // Tab skips the rows and their next-code buttons: it goes to the search field, Settings and the + button, and Up
    // and Down go from the search field through the rows (keyboardRows).
    row.tabIndex = -1;
    element('h2', row).textContent = record.name;
    row.prepend(createAccountIcon(record.name));
    const code = element('output', row);
    code.removeAttribute('id');
    const timerIcon = element('svg', row);
    timerIcon.removeAttribute('id');
    timerIcon.classList.add('timer');
    const sector = element('path', timerIcon);
    sector.removeAttribute('id');
    sector.classList.add('timer-sector');
    const account = {
      ...record, counter: BigInt(record.counter), search: searchText(record), entry: row, row, code, timer: timerIcon,
      sector, shownStep: null, pending: false, generate: null,
    };
    async function copy() {
      const value = code.textContent.replace(/\s/g, '');
      if (!/^\d{6}$/.test(value)) return;
      try {
        await navigator.clipboard.writeText(value);
        toast.show(t('codeCopied'), code.parentElement, { success: true });
      } catch {
        toast.show(t('clipboardFailed'), code.parentElement);
      }
    }
    account.copy = copy;
    row.addEventListener('click', copy);
    row.addEventListener('keydown', (event) => {
      if (!event.altKey && moveFocus(event, keyboardRows())) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copy(); }
      if (event.key === 'Delete') { event.preventDefault(); onRemove({ id: record.id, name: record.name }); }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const index = accounts.indexOf(account);
        move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
      }
    });
    if (record.type === 'hotp') {
      timerIcon.hidden = true;
      const entry = document.createElement('div');
      entry.className = 'account-entry';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'counter-next icon-button';
      next.tabIndex = -1;
      next.setAttribute('aria-label', t('nextCodeFor', record.name));
      const icon = document.createElement('span');
      icon.className = 'icon icon-refresh';
      next.append(icon);
      next.disabled = true;
      next.addEventListener('click', () => advance(account));
      account.next = next;
      account.entry = entry;
      entry.append(row, next);
    }
    // The Menu key and Shift+F10 open the menu too; it then appears on the row instead of at the pointer.
    account.entry.addEventListener('keydown', (event) => {
      fromKeyboard = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    });
    account.entry.addEventListener('pointerdown', () => { fromKeyboard = false; });
    account.entry.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const point = fromKeyboard ? { x: rect.left + 16, y: rect.bottom - 8 } : { x: event.clientX, y: event.clientY };
      fromKeyboard = false;
      onMenu({ id: record.id, name: record.name }, point);
    });
    return account;
  }

  // A new code replaces the shown one as the timer fills again, digit by digit from the left: each old digit shrinks
  // and fades away, and the new ones grow from their centre, starting while the old ones are still going. Every digit
  // takes part, also one that stays the same. The old code goes on a copy laid over the new one, which screen readers
  // and copying, which reads the code itself, never see. A row's first code, at once, and reduced motion show at once.
  function showCode(account, text, atOnce = false) {
    const { code } = account;
    const area = code.parentElement;
    area.querySelector('.code-old')?.remove();
    const before = code.textContent;
    if (atOnce || reducedMotion() || account.shownStep === null) {
      code.textContent = text;
      return;
    }
    if (before === text) return;
    code.replaceChildren(...codeNodes(text));
    code.querySelectorAll('.code-digit').forEach((digit, index) => digit.animate(
      [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'none' }],
      {
        duration: DIGIT_IN_MS, delay: DIGIT_IN_DELAY_MS + DIGIT_STEP_MS * index,
        easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards',
      },
    ));
    // Only a code goes away digit by digit, not an error message.
    if (!/^\d{3} \d{3}$/.test(before)) return;
    const old = document.createElement('span');
    old.className = 'code-old';
    old.setAttribute('aria-hidden', 'true');
    old.append(...codeNodes(before));
    area.append(old);
    const going = [...old.querySelectorAll('.code-digit')].map((digit, index) => digit.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.5)' }],
      { duration: DIGIT_OUT_MS, delay: DIGIT_STEP_MS * index, easing: 'cubic-bezier(0.3, 0, 1, 1)', fill: 'forwards' },
    ));
    going.at(-1).finished.then(() => old.remove(), () => {});
  }

  async function refresh() {
    const current = revision;
    const seconds = Math.floor(Date.now() / 1000);
    for (const account of accounts) {
      try {
        if (account.type === 'hotp' && !revealed.has(account.id)) {
          showCode(account, HIDDEN_CODE, true);
          account.shownStep = null;
        } else {
          const step = account.type === 'hotp' ? account.counter : totpStep(seconds);
          if (account.shownStep !== step) {
            account.generate ??= await createHotpGenerator(account.secret);
            const value = await account.generate(step);
            if (current !== revision) return;
            showCode(account, `${value.slice(0, 3)} ${value.slice(3)}`);
            account.shownStep = step;
          }
        }
        if (account.next) account.next.disabled = account.pending || account.counter >= MAX_COUNTER;
        else {
          const remaining = TOTP_PERIOD - seconds % TOTP_PERIOD;
          // A label for screen readers only: no tooltip.
          account.timer.setAttribute('aria-label', t('newCodeIn', remaining));
          countdown.draw(account.sector, remaining);
        }
      } catch {
        if (current !== revision) return;
        showCode(account, t('codeError'), true);
        account.timer.setAttribute('aria-label', t('codeUnavailable'));
        countdown.draw(account.sector, 0);
      }
    }
  }

  function update() {
    dirty = true;
    pendingUpdate ??= (async () => {
      try { do { dirty = false; await refresh(); } while (dirty); }
      finally { pendingUpdate = null; }
    })();
    return pendingUpdate;
  }

  const sameAccounts = (records) => records.length === accounts.length && records.every((record, index) => {
    const account = accounts[index];
    return account.id === record.id && account.name === record.name
      && account.type === record.type && account.secret === record.secret;
  });

  function render(records, { locked = false } = {}) {
    if (!locked && !cleared && sameAccounts(records)) {
      // Only counters or sites changed: keep the rows, so keyboard focus, a visible toast and pending work survive.
      records.forEach((record, index) => {
        accounts[index].counter = BigInt(record.counter);
        accounts[index].search = searchText(record);
      });
    } else {
      revision++;
      reorder.cancel();
      toast.clear();
      countdown.clear();
      accounts = records.map(createAccount);
      main.replaceChildren(...accounts.map((account) => account.entry));
    }
    cleared = locked;
    filter();
    onRender(records);
  }

  // Focuses the row of an account; without a visible one, the + button on an empty list, or the search field.
  function focus(id) {
    const account = accounts.find((entry) => entry.id === id && !entry.entry.hidden);
    (account?.row ?? (empty.hidden || emptyState.hidden ? search : add)).focus();
  }

  // The visible account after this one, or before it when it is the last: focus moves there after a removal.
  function neighbour(id) {
    const visible = accounts.filter((entry) => !entry.entry.hidden);
    const index = visible.findIndex((entry) => entry.id === id);
    return index === -1 ? null : (visible[index + 1] ?? visible[index - 1])?.id ?? null;
  }

  // Moves an account to a new index. The rows change at once, and go back if the write fails.
  async function move(from, to) {
    if (!canReorder() || from === to || to < 0 || to >= accounts.length) return;
    const previous = accounts;
    const account = accounts[from];
    const target = accounts[to];
    // Moving a row in the page drops its focus, so it is given back.
    const focused = document.activeElement === account.row;
    const arrange = () => {
      main.replaceChildren(...accounts.map((entry) => entry.entry));
      if (focused) account.row.focus();
    };
    accounts = accounts.filter((entry) => entry !== account);
    accounts.splice(to, 0, account);
    arrange();
    saving = true;
    const current = revision;
    try {
      const records = await vault.move(account.id, target.id, to > from);
      if (current === revision) render(records);
    } catch (failure) {
      if (current === revision) {
        accounts = previous;
        arrange();
        onError(failureText(failure, t('orderFailed')));
      }
    } finally {
      saving = false;
    }
  }

  function clear() {
    lockRevision++;
    revealed.clear();
    render([], { locked: true });
  }

  // Adds the accounts that generated a code in this unlock, also in other windows; only a lock removes them.
  function reveal(ids) {
    for (const id of ids) revealed.add(id);
  }

  function tick() {
    if (accounts.length && !document.hidden) update();
    timer = setTimeout(tick, 1000 - Date.now() % 1000);
  }
  // The search field, then the rows the search leaves: Up and Down move through them, and Enter in the search field
  // copies the first row's code, as in the lists for filling a field (fill-list.mjs).
  const keyboardRows = () => [search, ...accounts.filter((account) => !account.entry.hidden).map(({ row }) => row)];
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (moveFocus(event, keyboardRows()) || event.key !== 'Enter') return;
    event.preventDefault();
    accounts.find((account) => !account.entry.hidden)?.copy();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  tick();
  return {
    render, clear, reveal, filter, update, focus, neighbour,
    dispose() { clearTimeout(timer); clear(); },
    get busy() { return saving; },
  };
}
