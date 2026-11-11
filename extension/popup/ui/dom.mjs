export function element(selector, root = document) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing UI element: ${selector}`);
  return node;
}

export function message(node, text = '') {
  node.textContent = text;
  node.hidden = !text;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
