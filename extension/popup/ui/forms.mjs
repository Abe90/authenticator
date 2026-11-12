import { message } from './dom.mjs';
import { PASSWORD_MISMATCH, PASSWORD_TOO_SHORT } from './messages.mjs';
import { passwordProblem } from '../../core/limits.mjs';

// Resolves to what task returns, or to null after onError(error) when it fails.
export async function attempt(task, onError) {
  try {
    return await task();
  } catch (error) {
    onError(error);
    return null;
  }
}

// One action at a time on a page, with its button off while it runs. run() resolves as attempt() does, or to null
// while another action runs, and only once no longer busy, so that the caller may open the next page.
export function pageAction() {
  let busy = false;
  return {
    async run(button, task, onError) {
      if (busy) return null;
      busy = true;
      button.disabled = true;
      try {
        return await attempt(task, onError);
      } finally {
        busy = false;
        button.disabled = false;
      }
    },
    get busy() { return busy; },
  };
}

// Runs handler instead of submitting the form, as Enter in one of its fields does.
export function onSubmit(form, handler) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handler();
  });
}

// The error of a form: it marks the field it is about, and both clear when any field of the form changes.
export function formError(form, node) {
  let marked = null;
  function clear() {
    message(node);
    marked?.removeAttribute('aria-invalid');
    marked = null;
  }
  form.addEventListener('input', clear);
  return {
    show(text, field) {
      clear();
      message(node, text);
      marked = field ?? null;
      marked?.setAttribute('aria-invalid', 'true');
    },
    clear,
  };
}

// Why a new password and its confirmation cannot be saved, as [text, field] for formError().show, or null.
export function newPasswordProblem(password, confirm) {
  if (passwordProblem(password.value)) return [PASSWORD_TOO_SHORT, password];
  if (password.value !== confirm.value) return [PASSWORD_MISMATCH, confirm];
  return null;
}
