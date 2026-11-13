// The round icon left of an account's name, in the list (account-list.mjs) and in the lists for filling a field
// (fill-list.mjs): the first letter or digit of the name, in upper case, or its first character when it has neither.
// Screen readers skip it: the name is read anyway.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// toUpperCase, unlike toLocaleUpperCase, gives the same letter in every language of Firefox.
export function initial(name) {
  let first = '';
  for (const { segment } of graphemes.segment(name)) {
    if (LETTER_OR_DIGIT.test(segment)) return segment.toUpperCase();
    if (!first && segment.trim()) first = segment;
  }
  return first;
}

export function createAccountIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'account-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = initial(name);
  return icon;
}
