import { brandOf } from './brands.mjs';
import { siteKey, validSites } from './sites.mjs';

// The icon of an account without a bundled one (core/brands.mjs): the icon of a site's page, taken when the user
// opens the toolbar popup on it or fills a field of it (shared/site-icon.mjs). The icons stay on this computer, by
// site, sealed with the vault key (VaultSession.siteIcons): an account shows them on any of its sites, and another
// computer takes its own.

// An icon comes from a page, so only a PNG image that the extension's canvas code made is taken: a data: address of
// Base64 text, of a bounded length.
const MAX_IMAGE_LENGTH = 60_000;
const IMAGE_SHAPE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export const isSiteImage = (image) => (
  typeof image === 'string' && image.length <= MAX_IMAGE_LENGTH && IMAGE_SHAPE.test(image));

// Whether account has host's site among its sites and no bundled icon: the page's icon would show for it.
export function wantsSiteIcon(account, host) {
  const site = siteKey(host);
  return brandOf(account) === null && validSites(account.sites).some((entry) => siteKey(entry.host) === site);
}

// The icon of account among icons, { [site]: image }: that of the first of its sites that has one, or null; null
// also for an account with a bundled icon.
export function siteImage(account, icons) {
  if (brandOf(account) !== null) return null;
  for (const { host } of validSites(account.sites)) {
    const image = icons[siteKey(host)];
    if (isSiteImage(image)) return image;
  }
  return null;
}
