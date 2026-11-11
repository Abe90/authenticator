import { NAME_REQUIRED } from './account-input.mjs';
import { element, message } from './dom.mjs';
import { failureText } from './messages.mjs';

// Keeps the menu off the popup edges.
const EDGE = 4;
const removeTitleText = (name) => `Remove ${name}?`;

// The Edit and Remove menu of an account row (right click, Menu key or Shift+F10), and the Edit code and Remove
// pages it opens. onOpen(page, focus) shows a page; onLeave(id) goes back to the list and focuses the row of id,
// or the list itself when id is null.
export function createAccountActions({ vault, blocked, onOpen, onLeave, onRenamed, onRemoved, onFocus, neighbour }) {
  const menu = element('#account-menu');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const editName = element('#edit-name');
  const editError = element('#edit-error');
  const editSave = element('#edit-save');
  const removeTitle = element('#remove-title');
  const removeError = element('#remove-error');
  const removeConfirm = element('#remove-confirm');
  // The account the menu or a page acts on, as { id, name }.
  let target = null;
  // The accounts last shown in the list.
  let records = [];
  let saving = false;
  // Bumped by every close, so a save that finishes later no longer reports here.
  let revision = 0;

  // No wheel scrolling while the menu is open, as with Firefox's menus; listening only then keeps scrolling fast.
  const holdWheel = (event) => event.preventDefault();

  function hideMenu() {
    menu.hidden = true;
    document.removeEventListener('wheel', holdWheel, { capture: true });
  }

  // Forgets the menu and the account. With restore, focus goes back to the account's row.
  function close(restore = false) {
    revision++;
    const account = target;
    target = null;
    hideMenu();
    if (restore && account) onFocus(account.id);
  }

  // From a page back to the list, where focus goes to the row of id.
  function leave(id) {
    close();
    onLeave(id);
  }

  function begin(account) {
    if (saving || blocked()) return false;
    close();
    target = { id: account.id, name: account.name };
    return true;
  }

  // The point is the pointer position, or a point on the row when the menu was opened from the keyboard.
  function openMenu(account, point) {
    if (!begin(account)) return;
    menu.setAttribute('aria-label', account.name);
    menu.hidden = false;
    document.addEventListener('wheel', holdWheel, { capture: true, passive: false });
    const { width, height } = menu.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const top = point.y + height + EDGE <= clientHeight ? point.y : point.y - height;
    menu.style.left = `${Math.max(EDGE, Math.min(point.x, clientWidth - width - EDGE))}px`;
    menu.style.top = `${Math.max(EDGE, top)}px`;
    items[0].focus({ preventScroll: true });
  }

  function edit() {
    hideMenu();
    editName.value = target.name;
    editSave.disabled = false;
    message(editError);
    onOpen('edit', () => {
      editName.focus({ preventScroll: true });
      editName.select();
    });
  }

  function confirmRemove() {
    hideMenu();
    removeTitle.textContent = removeTitleText(target.name);
    removeConfirm.disabled = false;
    message(removeError);
    onOpen('remove');
  }

  // Follows the list: the page of an account removed in another window goes back to the list, a new name is shown.
  function apply() {
    if (!target) return;
    const record = records.find((entry) => entry.id === target.id);
    if (!record) {
      leave(null);
      return;
    }
    target.name = record.name;
    removeTitle.textContent = removeTitleText(record.name);
  }

  // On success done(saved, id) shows the change, then the page goes back to the list with focus on focusId's row.
  // A failure shows failureText() of the error, or the text failure.
  async function run(button, error, operation, failure, done, focusId) {
    if (saving || !target) return;
    const current = revision;
    const { id } = target;
    saving = true;
    button.disabled = true;
    message(error);
    try {
      const saved = await operation(id);
      if (current !== revision) return;
      // Saving is over: going back to the list must not wait for it.
      saving = false;
      close();
      await done(saved, id);
      onLeave(focusId);
    } catch (caught) {
      if (current === revision) message(error, failureText(caught, failure));
    } finally {
      saving = false;
      if (current === revision) {
        button.disabled = false;
        apply();
      }
    }
  }

  function submitEdit(event) {
    event.preventDefault();
    if (saving || !target) return;
    const name = editName.value.trim();
    if (!name) {
      message(editError, NAME_REQUIRED);
      editName.focus();
      return;
    }
    if (name === target.name) {
      leave(target.id);
      return;
    }
    run(editSave, editError, (id) => vault.rename(id, name), 'Could not save the name. Please try again.',
      onRenamed, target.id);
  }

  // Back to the list without saving: the back arrow, Escape and Cancel.
  function cancel() {
    if (!saving) leave(target?.id ?? null);
  }

  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      items[(moves[event.key] + items.length) % items.length].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  });
  menu.addEventListener('contextmenu', (event) => event.preventDefault());
  element('#menu-edit').addEventListener('click', () => { if (target) edit(); });
  element('#menu-remove').addEventListener('click', () => { if (target) confirmRemove(); });
  // A press elsewhere closes the menu, as a native one would. Scroll, resize and blur are not used: the popup fires
  // them by itself while the menu opens, and closes anyway when it loses focus.
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target)) close();
  }, true);

  element('#edit-form').addEventListener('submit', submitEdit);
  element('#edit-cancel').addEventListener('click', cancel);
  element('#remove-cancel').addEventListener('click', cancel);
  removeConfirm.addEventListener('click', () => {
    if (!target) return;
    // Taken before the write: the storage event of the write may redraw the list before it reports here.
    const next = neighbour(target.id);
    run(removeConfirm, removeError, (id) => vault.remove(id), 'Could not remove the account. Please try again.',
      onRemoved, next);
  });

  return {
    menu: openMenu,
    remove(account) { if (begin(account)) confirmRemove(); },
    sync(list) {
      records = list;
      if (!saving) apply();
    },
    close,
    cancel,
    get busy() { return saving; },
  };
}
