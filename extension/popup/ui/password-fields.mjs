import { element } from './dom.mjs';

// Password fields are text fields masked by CSS (.secret), never type="password": Firefox's password manager would
// otherwise offer to save the vault password and fill it in, which would leave the vault open to anyone at this
// computer. The eye at the right of each shows what was typed and hides it again; a reset of its form hides it too.
// While masked, the text cannot be copied, cut or dragged out.
export function setUpPasswordFields(root = document) {
  for (const field of root.querySelectorAll('.password-field')) {
    const input = element('input', field);
    const button = element('.reveal', field);
    const icon = element('.icon', button);
    const show = (visible) => {
      input.classList.toggle('revealed', visible);
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      icon.className = `icon ${visible ? 'icon-eye-off' : 'icon-eye'}`;
    };
    button.addEventListener('click', () => show(!input.classList.contains('revealed')));
    input.form?.addEventListener('reset', () => show(false));
    for (const type of ['copy', 'cut', 'dragstart']) {
      input.addEventListener(type, (event) => { if (!input.classList.contains('revealed')) event.preventDefault(); });
    }
  }
}
