import { element } from './dom.mjs';

export function createToast() {
  const toast = element('#toast');
  let timeout;

  function clear() {
    clearTimeout(timeout);
    toast.parentElement?.classList.remove('copying');
    toast.hidden = true;
    document.body.append(toast);
  }

  function show(text, anchor, { success = false } = {}) {
    clear();
    anchor.append(toast);
    anchor.classList.add('copying');
    toast.textContent = text;
    toast.classList.toggle('success', success);
    void toast.offsetWidth;
    toast.hidden = false;
    timeout = setTimeout(clear, 2000);
  }

  return { show, clear };
}
