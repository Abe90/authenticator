// How long the window that the popup or the background opens may restore an unlock that ends with the popup.
export const HANDOFF_MS = 10_000;
const ADD_WINDOW_PAGE = 'popup/popup.html?view=add';

export async function findAddCodeWindow(api = browser) {
  const url = api.runtime.getURL(ADD_WINDOW_PAGE);
  const windows = await api.windows.getAll({ populate: true, windowTypes: ['popup'] });
  return windows.find((entry) => entry.tabs?.some((tab) => tab.url === url)) ?? null;
}

export function openAddCodeWindow(api = browser, locks = navigator.locks) {
  // Serialises clicks from every window, so only one Add code window opens.
  return locks.request('authenticator-add-window', async () => {
    const existing = await findAddCodeWindow(api);
    if (existing) {
      const options = { focused: true };
      if (existing.state === 'minimized') options.state = 'normal';
      try {
        return await api.windows.update(existing.id, options);
      } catch (error) {
        // The user may close the window between discovery and focusing it.
        if ((await findAddCodeWindow(api))?.id === existing.id) throw error;
      }
    }
    return api.windows.create({ url: api.runtime.getURL(ADD_WINDOW_PAGE), type: 'popup', width: 420, height: 700 });
  });
}
