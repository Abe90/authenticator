// Movement before a press on a row becomes a drag rather than a click.
const THRESHOLD = 5;
// Within this distance of the list's top or bottom edge a drag scrolls the list, by STEP pixels a frame.
const EDGE = 32;
const STEP = 8;

// Reorders the rows of a scrolling list by mouse drag; onDrop(from, to) gets the indexes on release. rows() lists
// the row elements in order, blocked() stops a drag from starting, and Escape cancels one.
export function createReorder({ list, rows, blocked, onDrop }) {
  // The press that may become a drag. A cancelled drag keeps it until release, so the release is not a click.
  let press = null;
  // The drag in progress: the rows, their positions at the start, the source and target index.
  let drag = null;

  function clearShifts() {
    if (!drag) return;
    for (const entry of drag.entries) entry.style.transform = '';
    list.style.removeProperty('--reorder-lines');
    list.style.removeProperty('--reorder-places');
  }

  function layout() {
    const { entries, offsets, from, height } = drag;
    const last = offsets[offsets.length - 1];
    // The pointer picks the place, even past the list ends; the dragged row stays inside the list as it scrolls.
    const moved = drag.pointerY - drag.startY + list.scrollTop - drag.startScroll;
    const highest = offsets[0].top - offsets[from].top;
    const lowest = last.top + last.height - offsets[from].top - height;
    const shift = Math.max(highest, Math.min(lowest, moved));
    // A row makes room as soon as the dragged one covers half of it: its middle is passed by the leading edge.
    const top = offsets[from].top + moved;
    const middle = (index) => offsets[index].top + offsets[index].height / 2;
    let to = from;
    for (let index = from + 1; index < entries.length; index++) if (top + height > middle(index)) to = index;
    for (let index = from - 1; index >= 0; index--) if (top < middle(index)) to = index;
    drag.to = to;
    entries.forEach((entry, index) => {
      if (index === from) return;
      const offset = from < index && index <= to ? -height : to <= index && index < from ? height : 0;
      entry.style.transform = offset ? `translateY(${offset}px)` : '';
    });
    drag.entry.style.transform = `translateY(${shift}px)`;
    // The separators go under the bottom of each place in the new order, so with rows of one height they never move.
    // The last place has none.
    const heights = offsets.map((offset) => offset.height);
    heights.splice(to, 0, ...heights.splice(from, 1));
    heights.pop();
    let bottom = offsets[0].top;
    list.style.setProperty('--reorder-places', heights.map((rowHeight) => `${(bottom += rowHeight) - 1}px`).join());
  }

  function scroll() {
    if (!drag) return;
    const { top, bottom } = list.getBoundingClientRect();
    const step = drag.pointerY < top + EDGE ? -STEP : drag.pointerY > bottom - EDGE ? STEP : 0;
    const before = list.scrollTop;
    if (step) list.scrollTop += step;
    if (list.scrollTop !== before) layout();
    drag.frame = requestAnimationFrame(scroll);
  }

  function start() {
    const entries = rows();
    const from = entries.indexOf(press.entry);
    // Nothing to reorder: the press stays an ordinary click.
    if (entries.length < 2 || from === -1 || blocked()) {
      press = null;
      return;
    }
    const origin = list.getBoundingClientRect().top - list.scrollTop;
    const offsets = entries.map((entry) => {
      const { top, height } = entry.getBoundingClientRect();
      return { top: top - origin, height };
    });
    drag = {
      entries, offsets, from, to: from, entry: press.entry, height: offsets[from].height,
      startY: press.y, pointerY: press.y, startScroll: list.scrollTop, frame: 0,
    };
    // Keeps the pointer events coming while the pointer leaves the row or the popup.
    try { press.entry.setPointerCapture(press.pointerId); } catch {}
    list.style.setProperty('--reorder-lines', entries.slice(1).map(() => 'linear-gradient(var(--divider), var(--divider))').join());
    list.classList.add('reordering');
    press.entry.classList.add('dragging');
    window.addEventListener('keydown', escape, true);
    drag.frame = requestAnimationFrame(scroll);
  }

  // On release the lifted row slides into its place and settles, then the new order is reported.
  function drop() {
    if (!drag || drag.dropping) return;
    const current = drag;
    const { offsets, from, to, height, entry } = current;
    current.dropping = true;
    cancelAnimationFrame(current.frame);
    window.removeEventListener('keydown', escape, true);
    list.classList.add('dropping');
    const place = to > from ? offsets[to].top + offsets[to].height - height : offsets[to].top;
    entry.style.transform = `translateY(${place - offsets[from].top}px)`;
    // Without motion no transition starts, and the drop is reported at once.
    const settling = entry.getAnimations({ subtree: true }).filter((animation) => animation instanceof CSSTransition);
    Promise.allSettled(settling.map((animation) => animation.finished)).then(() => {
      if (drag === current) finish(true);
    });
  }

  // With drop, reports the new order. Transitions stay off while rows return, so a moved row does not slide in.
  function finish(drop) {
    if (!drag) return;
    const { from, to, entry, frame } = drag;
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', escape, true);
    list.classList.add('reorder-settling');
    clearShifts();
    list.classList.remove('reordering', 'dropping');
    entry.classList.remove('dragging');
    drag = null;
    try {
      if (drop && from !== to) onDrop(from, to);
    } finally {
      void list.offsetHeight;
      list.classList.remove('reorder-settling');
    }
  }

  function cancel() {
    if (press) press.cancelled = true;
    finish(false);
  }

  function escape(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  // A drag, even a cancelled one, ends without the click that would copy the code.
  function swallowClick() {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }

  list.addEventListener('pointerdown', (event) => {
    // A row still settling after a drop takes no new press.
    if (drag || event.button !== 0 || !event.isPrimary || event.target.closest('button')) return;
    const entry = rows().find((row) => row.contains(event.target));
    if (entry && !blocked()) press = { pointerId: event.pointerId, entry, y: event.clientY, cancelled: false };
  });
  window.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.pointerId || press.cancelled) return;
    if (!drag) {
      if (Math.abs(event.clientY - press.y) < THRESHOLD) return;
      start();
      if (!drag) return;
    }
    drag.pointerY = event.clientY;
    layout();
  });
  window.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const handled = Boolean(drag) || press.cancelled;
    press = null;
    drop();
    if (handled) swallowClick();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    window.addEventListener(type, (event) => {
      if (press && event.pointerId === press.pointerId) cancel();
    }, true);
  }
  // Images and text in a row must not start Firefox's own drag and drop.
  list.addEventListener('dragstart', (event) => event.preventDefault());

  return { cancel };
}
