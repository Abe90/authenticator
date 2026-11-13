import { hostFromUrl } from '../../core/sites.mjs';
import { captureSiteIcon } from '../../shared/site-icon.mjs';

// The icons of sites in the toolbar popup's list (core/site-icons.mjs): the list shows those this computer has, and
// the page of the tab where the popup opened gives its own when an account of its site has none. A private window's
// page is not asked, and the Add code window has no page.
export function createSiteIcons({ vault, list, addWindow }) {
  let pending = Promise.resolve();

  async function refresh(records) {
    if (!records.length) return;
    list.setImages(await vault.siteIcons());
    if (addWindow) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const host = hostFromUrl(tab?.url);
    if (!host || tab.incognito) return;
    if (await captureSiteIcon(vault, records, { tabId: tab.id, frameId: 0, host })) {
      list.setImages(await vault.siteIcons());
    }
  }

  // After each render of the list with records, one at a time.
  function update(records) {
    pending = pending.then(() => refresh(records)).catch(() => {});
  }

  return { update };
}
