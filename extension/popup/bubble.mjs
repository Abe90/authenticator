import { blockPageCommands, element, localize } from './ui/dom.mjs';
import { createFillList } from './ui/fill-list.mjs';

// The list of accounts under a field of a page, for the context menu (background/fill-bubble.mjs): the list of the
// popup's Fill in a code page (ui/fill-list.mjs), with at most ROWS_IN_SIGHT rows in sight, the others scrolling. A
// choice puts that account's code into the field; Escape or Tab closes the list and gives the field back the keyboard;
// the keyboard gone to another window or to Firefox's bars closes it too (content/fill-bubble.js). The page it shows
// on can neither read nor reach it.
const ROWS_IN_SIGHT = 8;
localize();
blockPageCommands();
const box = element('#bubble');
const rowsBox = element('.fill-accounts', box);
const port = browser.runtime.connect({ name: 'fill-bubble-list' });
const list = createFillList(box, { choose, onFilter: limit });
let rendered = false;
let chosen = false;

const send = (message) => {
  try { port.postMessage(message); } catch { /* The list is closing. */ }
};

// The frame takes the list's height, which the injected script gives it.
function report() {
  send({ type: 'size', height: box.getBoundingClientRect().height });
}

// Only ROWS_IN_SIGHT of the rows shown fit at once, the line among them when it comes before; the others scroll.
function limit() {
  rowsBox.style.maxHeight = '';
  const rows = list.shown();
  if (rows.length <= ROWS_IN_SIGHT) return;
  const height = rows[ROWS_IN_SIGHT].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
  rowsBox.style.maxHeight = `${height}px`;
}

// The point of the click goes with the choice, for the injected script to check that the list was there: where the
// pointer was, or the middle of the row for a key.
function choose(id, button, event = null) {
  if (chosen) return;
  let x;
  let y;
  if (event?.detail > 0) {
    x = event.clientX;
    y = event.clientY;
  } else {
    const rect = button.getBoundingClientRect();
    x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
    y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
  }
  chosen = true;
  send({ type: 'choose', id, at: Date.now(), x, y });
}

const isRow = (row) => typeof row?.id === 'string' && typeof row.name === 'string' && typeof row.search === 'string';
port.onMessage.addListener((message) => {
  if (message?.type === 'rows' && !rendered && Array.isArray(message.rows) && message.rows.every(isRow)
    && Number.isSafeInteger(message.matching)) {
    rendered = true;
    list.render(message.rows, Math.min(Math.max(message.matching, 0), message.rows.length));
    limit();
    new ResizeObserver(report).observe(box);
  } else if (message?.type === 'ignored') chosen = false;
});
// The token that the injected script put in this page's address: the background script sends the names only to the
// page that shows it.
send({ type: 'hello', token: location.hash.slice(1) });

document.addEventListener('keydown', (event) => {
  if (!event.isTrusted) return;
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    send({ type: 'cancel', refocus: true });
  } else list.onKey(event);
});
addEventListener('resize', limit);
// The frame takes the keyboard once the list shows (content/fill-bubble.js): a focus given before, while the frame was
// hidden, did not hold.
addEventListener('focus', (event) => {
  if (event.target === window && rendered && document.activeElement === document.body) list.focus();
});
// The keyboard left the list: for another window, Firefox's own bars or the page.
addEventListener('blur', (event) => {
  if (event.target === window) send({ type: 'blur' });
});
