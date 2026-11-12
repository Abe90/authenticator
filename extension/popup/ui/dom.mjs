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
