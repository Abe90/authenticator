import { element } from './dom.mjs';

// The notice page: a title and a message with only Close. It shows every error that does not belong to a form, and
// a scanned code that cannot be added. Close, the back arrow and Escape return to the page it opened from.
export function createNotice({ views }) {
  const title = element('#notice-title');
  const message = element('#notice-message');
  let from = 'list';
  // The control focused when the notice opened gets the focus back.
  let opener = null;

  // Fills the hidden page and the page to return to; the popup can then open straight on it.
  function fill(heading, text, returnTo) {
    title.textContent = heading;
    message.textContent = text;
    from = returnTo;
  }

  // Opens from the current page; a newer notice replaces the one showing.
  function show(heading, text) {
    if (views.current === 'notice') {
      fill(heading, text, from);
      return;
    }
    fill(heading, text, views.current);
    opener = document.activeElement;
    views.navigate('notice');
  }

  function close() {
    if (views.current !== 'notice') return;
    const control = opener?.isConnected ? opener : null;
    opener = null;
    views.navigate(from, control && (() => control.focus({ preventScroll: true })));
  }

  return { fill, show, close };
}
