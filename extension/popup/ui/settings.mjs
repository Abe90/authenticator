import { t } from '../../shared/i18n.mjs';
import { element } from './dom.mjs';

// When the vault locks by itself, the menu of Settings: 'close' when the last extension window closes, a number of
// minutes after that close, or 'never', which lasts until Firefox closes or Lock now.
const CLOSE = 'close';
const NEVER = 'never';
const CHOICES = new Set([CLOSE, 1, 5, 30, 60, NEVER]);
const DEFAULT = 5;
// The settings before the single menu: the Keep unlocked switch, a duration (0 for the browser session) and Until the
// popup closes. load() turns them into a choice of the menu and removes them.
const OLD_KEYS = ['keepUnlocked', 'unlockDurationMinutes', 'lockOnClose'];

function oldChoice(stored) {
  if (stored.keepUnlocked === true) return NEVER;
  if (stored.lockOnClose === true) return CLOSE;
  return stored.unlockDurationMinutes === 0 ? NEVER : stored.unlockDurationMinutes;
}

export function normalizeSettings(stored) {
  const autoLock = 'autoLock' in stored ? stored.autoLock : oldChoice(stored);
  return { autoLock: CHOICES.has(autoLock) ? autoLock : DEFAULT };
}

export function createSettings({ vault, storage, onError }) {
  const menu = element('#auto-lock');
  let saved;
  let busy = false;

  function apply(settings) {
    menu.value = String(settings.autoLock);
  }

  function read() {
    const { value } = menu;
    return { autoLock: value === CLOSE || value === NEVER ? value : Number(value) };
  }

  async function load() {
    const stored = await storage.get(['autoLock', ...OLD_KEYS]);
    saved = normalizeSettings(stored);
    apply(saved);
    if (OLD_KEYS.some((key) => key in stored)) {
      storage.set(saved).then(() => storage.remove(OLD_KEYS)).catch(() => {});
    }
  }

  // The remembered unlock takes the minutes after the last window holding it closes, 0 for no time limit, and
  // whether that close locks.
  const rememberWith = ({ autoLock }, holder) => (
    vault.remember(typeof autoLock === 'number' ? autoLock : 0, autoLock === CLOSE, holder));

  // A new unlock, handed off to the window holder: it takes the stored choice, which another window may have changed
  // since this menu showed it.
  async function remember(holder) {
    const stored = await storage.get(['autoLock', ...OLD_KEYS]);
    saved = normalizeSettings(stored);
    apply(saved);
    await rememberWith(saved, holder);
  }

  async function save() {
    if (busy) return;
    busy = true;
    menu.disabled = true;
    const next = read();
    let stored = false;
    try {
      await storage.set(next);
      stored = true;
      await rememberWith(next);
      saved = next;
    } catch {
      apply(saved);
      onError(t('settingFailed'));
      // The remembered unlock is written last, so only the stored preference can be ahead of the menu.
      if (stored) {
        try { await storage.set(saved); }
        catch { /* Rewritten by the next successful change. */ }
      }
    } finally {
      menu.disabled = false;
      busy = false;
    }
  }

  menu.addEventListener('change', save);
  // Another window changed the choice.
  storage.onChanged.addListener((changes) => {
    if (!('autoLock' in changes) || busy) return;
    saved = normalizeSettings({ autoLock: changes.autoLock.newValue });
    apply(saved);
  });
  return { load, remember, get busy() { return busy; } };
}
