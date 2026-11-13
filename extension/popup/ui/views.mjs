import { element, reducedMotion } from './dom.mjs';

// The pages of the popup: what each shows in <header> and below it, and the control it focuses on arrival. Every
// page reached from the list has the same header, a back arrow and a title, and leaves the same way (popup.mjs).
const PAGES = {
  auth: { nodes: ['#auth-header', '#auth-form'], focus: '#vault-password' },
  list: { nodes: ['.search-field', '#settings', 'main', '#search-empty', '#list-actions'], focus: '#search' },
  add: { nodes: ['#add-header', '#account-form'], focus: '#account-name' },
  settings: { nodes: ['#settings-header', '#settings-panel'], focus: '#settings-back' },
  scan: { nodes: ['#scan-header', '#scan-confirm'], focus: '#scan-name' },
  notice: { nodes: ['#notice-header', '#notice-panel'], focus: '#notice-close' },
  // Codes, read-only: a vault the password opens but cannot unlock, from the password page.
  recovery: { nodes: ['#recovery-header', '#recovery-panel'], focus: '#recovery-close' },
  edit: { nodes: ['#edit-header', '#edit-form'], focus: '#edit-name' },
  // Fill in a code, from the context menu of a page's field: the accounts to choose from.
  fill: { nodes: ['#fill-header', '#fill-panel'], focus: '#fill-accounts .fill-account' },
  remove: { nodes: ['#remove-header', '#remove-panel'], focus: '#remove-cancel' },
  // Change password and New recovery key: the password first, on a page like the password page.
  verify: { nodes: ['#verify-header', '#verify-form'], focus: '#verify-password' },
  password: { nodes: ['#password-header', '#password-form'], focus: '#password-new' },
  // Forgot password: the recovery key first, then the new password on the page of Change password.
  reset: { nodes: ['#reset-header', '#reset-form'], focus: '#reset-key' },
  'new-key': { nodes: ['#new-key-header', '#new-key-form'], focus: '#new-key-saved' },
  // After an unlock: another vault, its removal, and a key added on two computers.
  other: { nodes: ['#other-header', '#other-panel'], focus: '#other-add' },
  'remove-vault': { nodes: ['#remove-vault-header', '#remove-vault-panel'], focus: '#remove-vault-cancel' },
  // Another vault's codes: its password or recovery key, then its codes.
  'merge-open': { nodes: ['#merge-open-header', '#merge-open-form'], focus: '#merge-password' },
  'merge-codes': { nodes: ['#merge-codes-header', '#merge-codes-form'], focus: '#merge-add' },
  // A vault that left Firefox Sync, from this computer's copy: its password or recovery key, then its codes.
  'restore-open': { nodes: ['#restore-open-header', '#restore-open-form'], focus: '#restore-password' },
  'restore-codes': { nodes: ['#restore-codes-header', '#restore-codes-form'], focus: '#restore-submit' },
  duplicates: { nodes: ['#duplicates-header', '#duplicates-panel'], focus: '#duplicates-choices input' },
  // The first setup: the choice, then a new vault's password and recovery key, or Get your codes.
  setup: { nodes: ['#setup-header', '#setup-choice'], focus: '#choose-new' },
  'setup-password': { nodes: ['#setup-password-header', '#setup-password-form'], focus: '#new-password' },
  'setup-key': { nodes: ['#setup-key-header', '#setup-key-form'], focus: '#key-saved' },
  'get-codes': { nodes: ['#get-codes-header', '#get-codes-panel'], focus: '#get-codes-back' },
};

export function createViews({ blocked, onAddEnter, onAddLeave, onChange }) {
  const groups = Object.fromEntries(Object.entries(PAGES)
    .map(([name, page]) => [name, page.nodes.map((selector) => element(selector))]));
  let current = 'auth';
  document.body.dataset.view = current;
  let changing = false;
  let arrive = null;
  // The pages that led to the current one. Going to one of them goes back, and the pages slide the other way: back
  // from Settings to the list, or Lock now to the password page that opened the list. Anywhere else is forward, as
  // an unlock is.
  let trail = [current];

  async function animate(nodes, entering, returning) {
    if (reducedMotion() || document.documentElement.hasAttribute('data-starting')) return;
    const offset = entering ? (returning ? -4 : 4) : (returning ? 4 : -4);
    const frames = [
      { opacity: entering ? 0 : 1, transform: `translateX(${entering ? offset : 0}px)` },
      { opacity: entering ? 1 : 0, transform: `translateX(${entering ? 0 : offset}px)` },
    ];
    const animations = nodes.filter((node) => !node.hidden)
      .map((node) => node.animate(frames, { duration: 160, easing: entering ? 'ease-out' : 'ease-in', fill: 'both' }));
    try { await Promise.all(animations.map((animation) => animation.finished)); }
    finally { animations.forEach((animation) => animation.cancel()); }
  }

  // focus, when given, runs once the page is in, instead of focusing the page's own control. Focus moved by the
  // popup shows no focus ring; Tab brings it back.
  async function navigate(target, focus) {
    if (changing || blocked() || current === target) return;
    changing = true;
    const previous = current;
    const back = trail.indexOf(target);
    const returning = back >= 0;
    try {
      if (target === 'add') onAddEnter();
      document.body.classList.add('view-changing');
      await animate(groups[previous], false, returning);
      for (const [name, nodes] of Object.entries(groups)) {
        nodes.forEach((node) => { node.hidden = name !== target; });
      }
      current = target;
      trail = returning ? trail.slice(0, back + 1) : [...trail, target];
      document.body.dataset.view = target;
      if (previous === 'add') onAddLeave();
      element('#search').disabled = target !== 'list';
      onChange();
      await animate(groups[target], true, returning);
      arrive = focus ?? (() => element(PAGES[target].focus).focus({ preventScroll: true, focusVisible: false }));
      arrive();
    } finally {
      document.body.classList.remove('view-changing');
      changing = false;
    }
  }

  // Focuses the current page's control again, as on arrival.
  const focusPage = () => arrive?.();

  return { navigate, focusPage, get current() { return current; }, get changing() { return changing; } };
}
