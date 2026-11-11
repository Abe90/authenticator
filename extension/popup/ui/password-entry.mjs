import { message } from './dom.mjs';
import { onSubmit } from './forms.mjs';

// How long typing pauses before the password is tried on its own.
const PAUSE_MS = 450;

// A password form that tries the password on its own once typing pauses, and on Enter or its button. attempt(password,
// { automatic, stale, fail }) does the work: stale() is true once the password changed since, and fail(text, field)
// shows an error unless it did. A wrong password tried on its own should stay silent and leave the field as it is.
export function createPasswordEntry({ form, input, submit, error, label, busyLabel, active, blocked, attempt }) {
  // The button's label is its last text, after the icon it may have.
  const caption = submit.lastChild;
  let busy = false;
  let timer;
  let revision = 0;
  let composing = false;

  // An error about the password also marks the field, until the password changes or the form is set up again.
  function showError(text, field) {
    message(error, text);
    field?.setAttribute('aria-invalid', 'true');
  }
  function clearError() {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  }
  function schedule() {
    clearTimeout(timer);
    if (active() && !composing) timer = setTimeout(() => run(true), PAUSE_MS);
  }
  input.addEventListener('input', (event) => {
    revision++;
    clearError();
    clearTimeout(timer);
    if (!event.isComposing) schedule();
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
    revision++;
    clearTimeout(timer);
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    schedule();
  });

  async function run(automatic = false) {
    if (busy || blocked() || !active()) return;
    clearTimeout(timer);
    const current = revision;
    const stale = () => current !== revision;
    clearError();
    busy = true;
    submit.disabled = true;
    if (!automatic) {
      input.disabled = true;
      caption.textContent = busyLabel;
    }
    try {
      const fail = (text, field) => { if (!stale()) showError(text, field); };
      await attempt(input.value, { automatic, stale, fail });
    } finally {
      busy = false;
      input.disabled = false;
      submit.disabled = false;
      caption.textContent = label;
      if (active()) {
        if (!automatic) input.focus();
        if (stale()) schedule();
      }
    }
  }
  onSubmit(form, () => run());

  return {
    // Ready for a new password: empty, enabled and without an error.
    reset() {
      clearTimeout(timer);
      revision++;
      form.reset();
      input.disabled = false;
      submit.disabled = false;
      caption.textContent = label;
      clearError();
    },
    // Stops a pending try and empties the field.
    cancel() {
      clearTimeout(timer);
      revision++;
      form.reset();
    },
    focus() { if (!input.disabled) input.focus({ preventScroll: true }); },
    showError,
    get busy() { return busy; },
  };
}
