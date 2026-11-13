import { isBrand, isDarkBrand } from '../../core/brands.mjs';
import { isSiteImage } from '../../core/site-icons.mjs';

// The icon left of an account's name, in the list (account-list.mjs) and in the lists for filling a field
// (fill-list.mjs): the bundled icon of its service (core/brands.mjs), or the first letter or digit of the name, in
// upper case, or its first character when it has neither, white on the shield of assets/icons/account.svg. Screen
// readers skip it: the name is read anyway.
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

// brand: the name of a bundled icon, or null. Its file is drawn in the service's colours. One too dark for the dark
// theme is also the mask of its box, which that theme fills with the colour of the text instead (popup.css). The
// address starts at the extension's root, the same from the popup and from the list under a field.
export function createAccountIcon(name, brand = null, image = null) {
  const icon = document.createElement('span');
  icon.className = 'account-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (isBrand(brand)) {
    const logo = document.createElement('span');
    logo.className = 'brand-icon';
    const file = `url('/assets/brands/${brand}.svg')`;
    logo.style.backgroundImage = file;
    if (isDarkBrand(brand)) {
      logo.classList.add('brand-icon-dark');
      logo.style.maskImage = file;
    }
    icon.append(logo);
  } else if (isSiteImage(image)) {
    const logo = document.createElement('span');
    logo.className = 'brand-icon site-icon';
    logo.style.backgroundImage = `url('${image}')`;
    icon.append(logo);
  } else {
    icon.classList.add('letter-icon');
    icon.textContent = initial(name);
  }
  return icon;
}
