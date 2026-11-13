import { searchQuery } from '../../core/search.mjs';
import { createAccountIcon } from './account-icon.mjs';
import { element, moveFocus } from './dom.mjs';

// The accounts that can fill a field, by name: on the popup's Fill in a code page (fill-page.mjs) and in the list under
// a field (../bubble.mjs). Those of the page come first, then a line and the others; with more than SEARCH_AFTER
// accounts a search field comes on top, which finds them by name or by site (core/search.mjs). Up and Down move
// between the search field and the rows, which Tab skips, and Enter in the search field chooses the first row shown.
const SEARCH_AFTER = 10;

// root holds a .search-field with its input, a .fill-accounts box and a .fill-empty message. choose(id, button, event)
// runs on a row's click, with the click's event, or on Enter in the search field, without one; onFilter after the
// search changed the rows shown.
export function createFillList(root, { choose, onFilter = () => {} }) {
  const searchField = element('.search-field', root);
  const search = element('input', searchField);
  const list = element('.fill-accounts', root);
  // Firefox stops Tab on a box that scrolls with nothing to focus inside, which the rows are, since Tab skips them.
  list.tabIndex = -1;
  const empty = element('.fill-empty', root);
  // [{ id, search, button }], the first matching of them those of the page.
  let rows = [];
  let matching = 0;
  let line = null;

  // accounts, [{ id, name, search }], the first count of them matching the page.
  function render(accounts, count) {
    rows = accounts.map(({ id, name, search: text }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fill-account';
      button.tabIndex = -1;
      const label = document.createElement('span');
      label.className = 'fill-account-name';
      label.textContent = name;
      button.append(createAccountIcon(name), label);
      button.addEventListener('click', (event) => { if (event.isTrusted) choose(id, button, event); });
      return { id, search: text, button };
    });
    matching = count;
    const children = rows.map((row) => row.button);
    line = null;
    if (matching > 0 && matching < rows.length) {
      line = document.createElement('hr');
      line.className = 'fill-line';
      children.splice(matching, 0, line);
    }
    list.replaceChildren(...children);
    search.value = '';
    searchField.hidden = rows.length <= SEARCH_AFTER;
    empty.hidden = true;
  }

  // The rows the search leaves, in order, and their buttons.
  const visibleRows = () => rows.filter((row) => !row.button.hidden);
  const shown = () => visibleRows().map((row) => row.button);

  function filter() {
    const query = searchQuery(search.value);
    let visible = 0;
    let visibleMatching = 0;
    rows.forEach((row, index) => {
      const found = row.search.includes(query);
      row.button.hidden = !found;
      if (!found) return;
      visible++;
      if (index < matching) visibleMatching++;
    });
    if (line) line.hidden = visibleMatching === 0 || visibleMatching === visible;
    empty.hidden = visible > 0;
    onFilter();
  }

  // Gives the keyboard to the search field, or to the first row without one.
  function focus() {
    (searchField.hidden ? rows[0]?.button : search)?.focus();
  }

  // Up and Down, and Enter in the search field.
  function onKey(event) {
    if (moveFocus(event, [...(searchField.hidden ? [] : [search]), ...shown()])) return;
    if (event.key !== 'Enter' || document.activeElement !== search) return;
    event.preventDefault();
    const [first] = visibleRows();
    if (first) choose(first.id, first.button);
  }

  function clear() {
    rows = [];
    line = null;
    list.replaceChildren();
    search.value = '';
  }

  search.addEventListener('input', filter);
  return { render, shown, focus, onKey, clear };
}
