import { element } from './dom.mjs';

// The + button at the bottom right of the list and its menu just above it: Scan a QR code (#scan) and Enter a setup
// key (#add-code), whose clicks the popup handles. A choice, a press elsewhere, Escape and Tab close the menu.
export function createAddMenu() {
  const button = element('#add');
  const menu = element('#add-menu');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];

  // With restore, focus goes back to the round button.
  function close(restore = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore) button.focus();
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items[0].focus({ preventScroll: true });
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
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
  menu.addEventListener('click', (event) => {
    if (event.target.closest('[role="menuitem"]')) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) close();
  }, true);

  return { close };
}
