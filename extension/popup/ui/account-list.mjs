import { MAX_COUNTER } from '../../core/limits.mjs';
import { TOTP_PERIOD, createHotpGenerator, totpStep } from '../../core/totp.mjs';
import { element, reducedMotion } from './dom.mjs';
import { createCountdown } from './countdown.mjs';
import { failureText } from './messages.mjs';
import { createToast } from './toast.mjs';
import { createReorder } from './reorder.mjs';

// HOTP accounts show this until their next-code button is pressed during the current unlock.
const HIDDEN_CODE = '--- ---';

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
  // Reordering waits for other writes, and is off while a search hides some rows.
  const canReorder = () => !saving && !blocked() && accounts.length > 1
    && accounts.every((account) => !account.entry.hidden);
  const reorder = createReorder({
    list: main, rows: () => accounts.map((account) => account.entry), blocked: () => !canReorder(), onDrop: move,
  });

  function filter() {
    const hasText = search.value.length > 0;
    settings.classList.toggle('clear-search', hasText);
    settings.setAttribute('aria-label', hasText ? 'Clear search' : 'Settings');
    if (hasText) {
      settings.removeAttribute('aria-controls');
      settings.removeAttribute('aria-expanded');
    } else {
      settings.setAttribute('aria-controls', 'settings-panel');
      settings.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    }
    const query = search.value.trim().toLocaleLowerCase('en');
    let visible = 0;
    for (const account of accounts) {
      const matches = account.name.toLocaleLowerCase('en').includes(query);
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
      if (current === revision) onError(failureText(failure, 'Could not save the next counter. Please try again.'));
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
    row.setAttribute('aria-label', `${record.name}: copy code`);
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    element('h2', row).textContent = record.name;
    const code = element('output', row);
    code.removeAttribute('id');
    const timerIcon = element('svg', row);
    timerIcon.removeAttribute('id');
    timerIcon.classList.add('timer');
    const sector = element('path', timerIcon);
    sector.removeAttribute('id');
    sector.classList.add('timer-sector');
    const account = {
      ...record, counter: BigInt(record.counter), entry: row, row, code, timer: timerIcon, sector,
      shownStep: null, pending: false, generate: null,
    };
    async function copy() {
      const value = code.textContent.replace(/\s/g, '');
      if (!/^\d{6}$/.test(value)) return;
      try {
        await navigator.clipboard.writeText(value);
        toast.show('Code copied', code.parentElement, { success: true });
      } catch {
        toast.show('Copy failed. Please try again.', code.parentElement);
      }
    }
    row.addEventListener('click', copy);
    row.addEventListener('keydown', (event) => {
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
      next.setAttribute('aria-label', `Generate the next code for ${record.name}`);
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

  // A new code shows digit by digit as the timer fills again: each digit that changed fades in and grows from its own
  // centre, a little after the one before it. A row's first code, at once, and reduced motion show at once.
  function showCode(account, text, atOnce = false) {
    const { code } = account;
    const before = code.textContent;
    if (atOnce || reducedMotion() || account.shownStep === null) {
      code.textContent = text;
      return;
    }
    if (before === text) return;
    let order = 0;
    code.replaceChildren(...[...text].map((character, index) => {
      if (character === ' ') return document.createTextNode(' ');
      const digit = document.createElement('span');
      digit.className = 'code-digit';
      digit.textContent = character;
      if (character !== before[index]) {
        digit.animate([{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'none' }],
          { duration: 300, delay: 25 * order++, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
      }
      return digit;
    }));
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
          account.timer.setAttribute('aria-label', `New code in ${remaining} s`);
          countdown.draw(account.sector, remaining);
        }
      } catch {
        if (current !== revision) return;
        showCode(account, 'Error', true);
        account.timer.setAttribute('aria-label', 'Code unavailable. Reopen the popup.');
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
      // Only counters changed: keep the rows, so keyboard focus, a visible toast and pending work survive.
      records.forEach((record, index) => { accounts[index].counter = BigInt(record.counter); });
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
        onError(failureText(failure, 'Could not save the new order. Please try again.'));
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
  search.addEventListener('input', filter);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  tick();
  return {
    render, clear, reveal, filter, update, focus, neighbour,
    dispose() { clearTimeout(timer); clear(); },
    get busy() { return saving; },
  };
}
