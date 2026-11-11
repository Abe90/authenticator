import { element } from './dom.mjs';

// How good a new password looks, from 0 to 100, weighed as the Primary Password dialog of Firefox does
// (toolkit/content/mozapps/preferences/changemp.js): its length up to 5 characters, and up to 3 each of digits,
// symbols and capitals.
export function passwordQuality(password) {
  const count = (pattern) => Math.min(3, password.length - password.replace(pattern, '').length);
  const quality = Math.min(5, password.length) * 10 - 20
    + count(/[0-9]/g) * 10 + count(/\W/g) * 15 + count(/[A-Z]/g) * 10;
  return Math.max(0, Math.min(100, quality));
}

// Every password quality meter follows the field its data-password names, and empties when that field's form resets.
export function setUpPasswordMeters(root = document) {
  for (const meter of root.querySelectorAll('.password-meter')) {
    const input = element(`#${meter.dataset.password}`, root);
    input.addEventListener('input', () => { meter.value = passwordQuality(input.value); });
    input.form?.addEventListener('reset', () => { meter.value = 0; });
  }
}
