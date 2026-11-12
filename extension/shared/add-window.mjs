const ADD_WINDOW_PAGE = 'popup/popup.html?view=add';

export async function findAddCodeWindow(api = browser) {
  const url = api.runtime.getURL(ADD_WINDOW_PAGE);
  const windows = await api.windows.getAll({ populate: true, windowTypes: ['popup'] });
  return windows.find((entry) => entry.tabs?.some((tab) => tab.url === url)) ?? null;
}

// Resolves to { window, created }: created is false when the Add code window was already open.
export function openAddCodeWindow(api = browser, locks = navigator.locks) {
  // Serialises clicks from every window, so only one Add code window opens.
  return locks.request('authenticator-add-window', async () => {
    const existing = await findAddCodeWindow(api);
    if (existing) {
      const options = { focused: true };
      if (existing.state === 'minimized') options.state = 'normal';
      try {
        return { window: await api.windows.update(existing.id, options), created: false };
      } catch (error) {
        // The user may close the window between discovery and focusing it.
        if ((await findAddCodeWindow(api))?.id === existing.id) throw error;
      }
    }
    const window = await api.windows.create({
      url: api.runtime.getURL(ADD_WINDOW_PAGE), type: 'popup', width: 420, height: 700,
    });
    return { window, created: true };
  });
}
