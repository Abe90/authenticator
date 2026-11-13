import { t } from '../../shared/i18n.mjs';

export function element(selector, root = document) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing UI element: ${selector}`);
  return node;
}

export function message(node, text = '') {
  node.textContent = text;
  node.hidden = !text;
}

// Puts the texts of _locales in the page: data-i18n names the message of a node's text, data-i18n-aria-label and
// data-i18n-placeholder those of its attributes. data-i18n-slots is for a sentence around the node's own elements:
// $1, $2… in its message are their places, in order.
export function localize(root = document) {
  document.documentElement.lang = t('locale');
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-slots]')) {
    const slots = [...node.children];
    const parts = t(node.dataset.i18nSlots, ...slots.map((slot, index) => `{${index}}`)).split(/\{(\d+)\}/);
    node.replaceChildren(...parts.map((part, index) => (index % 2 ? slots[part] : part)));
  }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Up and Down move the keyboard through items, in order, stopping at both ends: returns whether event was one of them.
export function moveFocus(event, items) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  const index = items.indexOf(document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : index + step;
  items[Math.min(Math.max(next, 0), items.length - 1)]?.focus();
  event.preventDefault();
  return true;
}

// Firefox's Save page (Ctrl+S) and Print (Ctrl+P) would save or print the extension's own page, and its context menu
// would offer Save Page, View Page Source and the like: the keys do nothing, and the menu shows only in text fields,
// where it cuts, copies and pastes.
export function blockPageCommands() {
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && ['s', 'p'].includes(event.key.toLowerCase())) event.preventDefault();
  });
  document.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('textarea, input[type="text"], input:not([type])')) event.preventDefault();
  });
}
