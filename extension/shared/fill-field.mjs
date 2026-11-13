import { createHotpGenerator, totpStep } from '../core/totp.mjs';

// A code put into a page's field from the context menu: by the background script when one account matches the page
// (background/fill-menu.mjs), by the toolbar popup when the user picks one (popup/ui/fill-page.mjs). The page gets the
// code, and nothing else.

// Runs in the clicked frame, as a content script, so Firefox serialises it: it uses nothing from around it. Finds the
// field the menu was opened on and tells whether it can take a code; given one, puts it in: one digit per box for a
// group of exactly six one-character inputs (codes always have six digits), the whole code otherwise. Disabled and
// read-only fields, and boxes outside such a group, cannot. The page sees an input and a change event, as from
// typing, so that frameworks such as React take the value.
function putCode(targetElementId, code) {
  const TEXT_TYPES = ['text', 'password', 'tel', 'number', 'search', 'email', 'url'];
  const DIGITS = 6;
  const isInput = (node) => node?.localName === 'input' && TEXT_TYPES.includes(node.type);
  const writable = (node) => !node.disabled && !node.readOnly;
  const field = browser.menus.getTargetElement(targetElementId);
  if (!field || !(isInput(field) || field.localName === 'textarea') || !writable(field)) return false;
  let boxes = [field];
  if (field.localName === 'input' && field.maxLength === 1) {
    const inputs = [...(field.form ?? field.getRootNode()).querySelectorAll('input')]
      .filter((node) => node.type !== 'hidden');
    const isBox = (node) => isInput(node) && node.maxLength === 1 && writable(node);
    const at = inputs.indexOf(field);
    if (at === -1) return false;
    let first = at;
    let last = at;
    while (first > 0 && isBox(inputs[first - 1])) first--;
    while (last < inputs.length - 1 && isBox(inputs[last + 1])) last++;
    if (last - first + 1 !== DIGITS) return false;
    boxes = inputs.slice(first, last + 1);
  }
  if (code === null) return true;
  const values = boxes.length === 1 ? [code] : [...code];
  boxes.forEach((box, index) => {
    box.focus();
    box.value = values[index];
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: values[index] }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return true;
}

// Puts code into the field of target, { tabId, frameId, targetElementId } from the menu's click, or with null only
// tells whether that field can take one. Resolves to whether it could; Firefox refuses a frame it keeps from
// extensions, a frame of another origin than the page's, and a page that changed since the click.
export function fillField(target, code) {
  return browser.scripting.executeScript({
    target: { tabId: target.tabId, frameIds: [target.frameId] }, func: putCode,
    args: [target.targetElementId, code],
  }).then(([injection]) => injection?.result === true, () => false);
}

// The code of account for a fill, from vault, held open: an HOTP account advances, as with the popup's next-code
// button, which then shows the same code (revealed, core/revealed-codes.mjs).
export async function fillCode(vault, revealed, account) {
  const generate = await createHotpGenerator(account.secret);
  if (account.type === 'totp') return generate(totpStep(Date.now() / 1000));
  const records = await vault.advance(account.id);
  await revealed.add(account.id).catch(() => {});
  return generate(BigInt(records.find((record) => record.id === account.id).counter));
}
