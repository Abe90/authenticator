import { TOTP_PERIOD, createHotpGenerator, totpStep } from '../../core/totp.mjs';
import { element } from './dom.mjs';
import { plural, t } from '../../shared/i18n.mjs';

// The trusted input that keeps the page open, as for an unlock (shared/open-windows.mjs).
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'];

// Codes, read-only: the accounts of a vault the password opened when it could not unlock (core/recovery.mjs), with
// their codes. Each code, and with its own button each key, can be copied; nothing can be added, renamed, merged or
// advanced, and nothing is written. An HOTP code is the one of the stored counter, which may have been used already.
// The key and the accounts live only in this page: closing the popup, the back arrow, Escape or Close end them, and
// so does the time of Lock automatically without input, 1 minute with When the popup closes (minutes()).
export function createRecoveryView({ recovery, views, minutes, onExit }) {
  const source = element('#recovery-source');
  const list = element('#recovery-accounts');
  const olderTitle = element('#recovery-older-title');
  const olderHint = element('#recovery-older-hint');
  const older = element('#recovery-older');
  const unreadable = element('#recovery-unreadable');
  const status = element('#recovery-status');
  let rows = [];
  let ticker = 0;
  let idleTimer = 0;
  let idleMs = null;
  let active = false;

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = done;
    } catch {
      status.textContent = t('clipboardFailed');
    }
  }

  function row(account) {
    const node = document.createElement('div');
    node.className = 'recovery-account';
    const name = document.createElement('span');
    name.className = 'recovery-name';
    name.textContent = account.name;
    const code = document.createElement('output');
    code.className = 'recovery-code';
    const note = document.createElement('span');
    note.className = 'recovery-note';
    if (account.type === 'hotp') note.textContent = t('hotpMayBeUsed');
    const copyCode = document.createElement('button');
    copyCode.type = 'button';
    copyCode.className = 'text-link';
    copyCode.textContent = t('copyCode');
    copyCode.addEventListener('click', () => {
      const value = code.textContent.replace(/\s/g, '');
      if (/^\d{6}$/.test(value)) copy(value, t('codeCopiedFor', account.name));
    });
    const copyKey = document.createElement('button');
    copyKey.type = 'button';
    copyKey.className = 'text-link';
    copyKey.textContent = t('copyKey');
    copyKey.addEventListener('click', () => copy(account.secret, t('keyCopiedFor', account.name)));
    node.append(name, code, note, copyCode, copyKey);
    return { account, code, note, generate: null, shown: null };
  }

  async function tick() {
    const seconds = Math.floor(Date.now() / 1000);
    for (const entry of rows) {
      const { account } = entry;
      const step = account.type === 'hotp' ? BigInt(account.counter) : totpStep(seconds);
      try {
        if (entry.shown !== step) {
          entry.generate ??= await createHotpGenerator(account.secret);
          const value = await entry.generate(step);
          if (!active) return;
          entry.code.textContent = `${value.slice(0, 3)} ${value.slice(3)}`;
          entry.shown = step;
        }
        if (account.type !== 'hotp') entry.note.textContent = t('newCodeIn', TOTP_PERIOD - seconds % TOTP_PERIOD);
      } catch {
        entry.code.textContent = '--- ---';
        entry.note.textContent = t('codeCannotShow');
      }
    }
  }

  function render(target, accounts) {
    const made = accounts.map(row);
    target.replaceChildren(...made.map(({ code }) => code.parentElement));
    return made;
  }

  function idle() {
    clearTimeout(idleTimer);
    if (active && idleMs !== null) idleTimer = setTimeout(stop, idleMs);
  }
  for (const type of INPUT_EVENTS) {
    document.addEventListener(type, (event) => { if (event.isTrusted && active) idle(); }, { passive: true });
  }

  // Forgets the key, the accounts and their codes.
  function clear() {
    active = false;
    clearInterval(ticker);
    clearTimeout(idleTimer);
    rows = [];
    list.replaceChildren();
    older.replaceChildren();
    status.textContent = '';
  }
  async function stop() {
    if (!active) return;
    clear();
    await onExit();
  }

  return {
    // found: what Recovery.find() returned.
    async start(found) {
      clear();
      const read = await recovery.read(found);
      active = true;
      const limit = await minutes();
      idleMs = limit === null ? null : limit * 60_000;
      source.textContent = found.trusted ? t('recoverySourceTrusted') : t('recoverySourceOther');
      rows = render(list, read.accounts);
      const old = render(older, read.older);
      rows.push(...old);
      for (const node of [olderTitle, olderHint, older]) node.hidden = !old.length;
      unreadable.hidden = !read.unreadable;
      unreadable.textContent = read.newer
        ? plural('unreadableNewer', read.unreadable)
        : plural('unreadableCodes', read.unreadable);
      await tick();
      ticker = setInterval(tick, 1000);
      idle();
      await views.navigate('recovery');
    },
    stop,
    // A lock or an unlock elsewhere ends it without leaving the page, which the caller changes.
    clear,
    get active() { return active; },
  };
}
