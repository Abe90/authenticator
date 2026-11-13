import {
  AFTER_UNLOCK_KEY, CLOSED_STORAGE_KEY, HANDOFF_STORAGE_KEY, HOLDERS_STORAGE_KEY, LAST_INPUT_STORAGE_KEY,
  PROCEDURE_KEY, REVEALED_STORAGE_KEY, UNLOCK_STORAGE_KEY, isId, randomId,
} from './storage-keys.mjs';

// What storage.session holds for one remembered unlock, removed together when it ends. The procedure a popup was in
// goes too: New recovery key keeps there a key that is not in use yet, which works once it is.
export const SESSION_KEYS = [
  UNLOCK_STORAGE_KEY, REVEALED_STORAGE_KEY, HANDOFF_STORAGE_KEY, AFTER_UNLOCK_KEY, CLOSED_STORAGE_KEY,
  HOLDERS_STORAGE_KEY, LAST_INPUT_STORAGE_KEY, PROCEDURE_KEY,
];
// How long the window that a popup or a scan opens, or that has just unlocked, has to take over the unlock.
export const HANDOFF_MS = 10_000;
// After the background script starts again, how long the windows that held the unlock have to connect again.
const RECONNECT_MS = 3000;
export const AUTO_LOCK_ALARM = 'auto-lock';
const SCAN_HOLDER = /^scan:[A-Za-z0-9_-]{11}$/;
const isScan = (id) => SCAN_HOLDER.test(id);

// Serialises every write to the remembered unlock across windows and the background script, so that reading which
// unlock is stored and the write that depends on it happen together. Nothing waits for the vault lock while holding
// this one, so the two never deadlock.
export const withUnlockLock = (operation) => navigator.locks.request('authenticator-unlock', operation);

// Lock now: ends whichever unlock is stored.
export function revokeUnlock(session, exclusive = withUnlockLock) {
  return exclusive(() => session.remove(SESSION_KEYS));
}

// A handoff counts for the unlock it was made for, until its time; one further ahead than a handoff lasts was made
// before the clock went back.
function handOffValid(handoff, entry, now) {
  return handoff?.sessionId === entry.sessionId && Number.isSafeInteger(handoff.until) && now < handoff.until
    && handoff.until - now <= HANDOFF_MS;
}

// The minutes without input after which an unlock that a window holds ends: the chosen minutes, 1 with "When the
// popup closes", none with "Never".
const idleMinutes = (entry) => (entry.lockOnClose === true ? 1 : entry.minutesAfterClose);
// A stored time counts only if it is a whole number of milliseconds, and not in the future: the clock went back.
const pastTime = (time, now) => Number.isSafeInteger(time) && time <= now;

// Whether the remembered unlock has ended, from what storage.session holds: entry, closedAt, handoff and
// lastInputAt, with held when a window or a scan holds the unlock. Only the times stored count: a missing or
// unreadable time, or one in the future after the clock went back, never starts a new period.
// - Held: it ends after its minutes without input in the windows that hold it (none with "Never").
// - Handed off to a window that has not taken it yet: it goes on.
// - "When the popup closes": it ends.
// - "Never" (no minutes): it goes on until Lock now or Firefox closes.
// - Timed: it ends its minutes after the close.
export function unlockEnded({ entry, closedAt, handoff, lastInputAt, held, now }) {
  if (!entry) return true;
  if (held) {
    const minutes = idleMinutes(entry);
    if (minutes === null) return false;
    return !pastTime(lastInputAt, now) || now >= lastInputAt + minutes * 60_000;
  }
  if (handOffValid(handoff, entry, now)) return false;
  if (entry.lockOnClose === true) return true;
  if (entry.minutesAfterClose === null) return false;
  if (!pastTime(closedAt, now)) return true;
  return now >= closedAt + entry.minutesAfterClose * 60_000;
}

// When unlockEnded() may next change its answer by time alone, or null.
export function nextCheck({ entry, closedAt, handoff, lastInputAt, held, now }) {
  if (!entry) return null;
  if (held) {
    const minutes = idleMinutes(entry);
    return minutes !== null && pastTime(lastInputAt, now) ? lastInputAt + minutes * 60_000 : null;
  }
  const times = [];
  if (handOffValid(handoff, entry, now)) times.push(handoff.until);
  if (entry.lockOnClose !== true && Number.isSafeInteger(entry.minutesAfterClose) && pastTime(closedAt, now)) {
    times.push(closedAt + entry.minutesAfterClose * 60_000);
  }
  return times.length ? Math.min(...times) : null;
}

// The background script's side of the auto-lock. It alone records which windows hold the unlock and when they last
// saw input, and it ends the unlock when the rule says so: at the last close, when an alarm fires at the next time
// that matters, and when it starts again after Firefox stopped it. Every step reads storage.session again under the
// unlock lock and decides from what is stored, never from the event that started it, so a late alarm or close cannot
// end a newer unlock.
//
// A window holds the unlock once a claim of it is granted, and until it locks or closes; a connection alone holds
// nothing. A scan that a holding window starts holds it as well while it lasts. Only input from holders counts.
export class AutoLock {
  #session;
  #alarms;
  #now;
  #exclusive;
  #setTimer;
  // windowId → port, for the windows connected to this run of the background script.
  #live = new Map();

  constructor({
    session, alarms, now = () => Date.now(), exclusive = withUnlockLock, setTimer = (run, ms) => setTimeout(run, ms),
  }) {
    this.#session = session;
    this.#alarms = alarms;
    this.#now = now;
    this.#exclusive = exclusive;
    this.#setTimer = setTimer;
  }

  async #read() {
    const stored = await this.#session.get(SESSION_KEYS);
    const entry = stored[UNLOCK_STORAGE_KEY] ?? null;
    const record = stored[HOLDERS_STORAGE_KEY];
    const ids = entry && record?.sessionId === entry.sessionId && Array.isArray(record.ids)
      ? record.ids.filter((id) => isId(id) || isScan(id)) : [];
    return {
      entry, ids, closedAt: stored[CLOSED_STORAGE_KEY], handoff: stored[HANDOFF_STORAGE_KEY],
      lastInputAt: stored[LAST_INPUT_STORAGE_KEY], now: this.#now(),
    };
  }

  #writeHolders(entry, ids) {
    if (!ids.length) return this.#session.remove(HOLDERS_STORAGE_KEY);
    return this.#session.set({ [HOLDERS_STORAGE_KEY]: { sessionId: entry.sessionId, ids } });
  }

  // Ends the unlock if the rule says so, or sets the alarm for the next time that matters.
  async #settle(state) {
    const view = { ...state, held: state.ids.length > 0 };
    if (state.entry && unlockEnded(view)) {
      await this.#session.remove(SESSION_KEYS);
      await this.#alarms.clear(AUTO_LOCK_ALARM);
      return;
    }
    const when = nextCheck(view);
    if (when === null) await this.#alarms.clear(AUTO_LOCK_ALARM);
    else await this.#alarms.create(AUTO_LOCK_ALARM, { when });
  }

  // The last holder left: closed tells that it closed now; otherwise nobody knows when, and the unlock is judged
  // without a close time.
  async #leave(state, id, closed) {
    const ids = state.ids.filter((held) => held !== id);
    await this.#writeHolders(state.entry, ids);
    let { closedAt } = state;
    if (!ids.length && closed) {
      closedAt = state.now;
      await this.#session.set({ [CLOSED_STORAGE_KEY]: closedAt });
    }
    return { ...state, ids, closedAt };
  }

  // The background script started. The windows that held the unlock before it stopped have RECONNECT_MS to connect
  // again; a scan it was running is gone.
  start() {
    return this.#exclusive(async () => {
      const state = await this.#read();
      const ids = state.ids.filter((id) => !isScan(id));
      if (ids.length !== state.ids.length) await this.#writeHolders(state.entry, ids);
      if (ids.length) this.#setTimer(() => this.#reconnected().catch(() => {}), RECONNECT_MS);
      await this.#settle({ ...state, ids });
    });
  }

  // A window that did not come back closed while the background script was stopped, at a time nobody recorded.
  #reconnected() {
    return this.#exclusive(async () => {
      const state = await this.#read();
      const ids = state.ids.filter((id) => isScan(id) || this.#live.has(id));
      if (ids.length !== state.ids.length) await this.#writeHolders(state.entry, ids);
      await this.#settle({ ...state, ids });
    });
  }

  // A window's port told who it is, and whether it believes it holds the unlock.
  connected(windowId, port, holding) {
    this.#live.set(windowId, port);
    // It locked while the background script was stopped, and its release was lost.
    if (holding === null) return this.#release(windowId, false);
    return Promise.resolve();
  }

  disconnected(windowId, port) {
    if (this.#live.get(windowId) !== port) return Promise.resolve();
    this.#live.delete(windowId);
    return this.#release(windowId, true);
  }

  // The window locked.
  release(windowId) {
    return this.#release(windowId, true);
  }

  #release(windowId, closed) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      if (!state.ids.includes(windowId)) return;
      await this.#settle(await this.#leave(state, windowId, closed));
    });
  }

  // A window (kind 'popup' or 'add') asks to hold the unlock with this sessionId, after reading its key. Granted
  // while another holder is connected, with a handoff for this window, or while the unlock has not ended. Opening a
  // window counts as input.
  claim(windowId, sessionId, kind) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      const { entry, handoff, ids, now } = state;
      if (!entry || entry.sessionId !== sessionId) return false;
      if (unlockEnded({ ...state, held: ids.length > 0 })) {
        await this.#settle(state);
        return false;
      }
      const handedOff = handOffValid(handoff, entry, now) && [windowId, kind, 'any'].includes(handoff.to);
      // A holder that has not connected again since a restart may never come back.
      const followed = ids.some((id) => isScan(id) || this.#live.has(id));
      if (!followed && !handedOff && unlockEnded({ ...state, handoff: null, held: false })) return false;
      const holders = [...new Set([...ids, windowId])];
      await this.#writeHolders(entry, holders);
      await this.#session.remove([CLOSED_STORAGE_KEY, ...(handedOff ? [HANDOFF_STORAGE_KEY] : [])]);
      await this.#session.set({ [LAST_INPUT_STORAGE_KEY]: now });
      await this.#settle({
        ...state, ids: holders, closedAt: undefined, handoff: handedOff ? undefined : handoff, lastInputAt: now,
      });
      return true;
    });
  }

  // A holding popup hands the unlock on to the Add code window ('add') it is about to open.
  handOff(windowId, to) {
    return this.#exclusive(async () => {
      const { entry, ids, now } = await this.#read();
      if (!entry || !ids.includes(windowId)) return false;
      const handoff = { sessionId: entry.sessionId, to, until: now + HANDOFF_MS };
      await this.#session.set({ [HANDOFF_STORAGE_KEY]: handoff });
      return true;
    });
  }

  // The Add code window was open already, so the handoff is not needed.
  cancelHandOff(windowId, to) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      if (state.handoff?.to !== to || !state.ids.includes(windowId)) return;
      await this.#session.remove(HANDOFF_STORAGE_KEY);
      await this.#settle({ ...state, handoff: undefined });
    });
  }

  // A scan started by a window that holds the unlock holds it too. Resolves to the scan's holder ID, or null.
  scanStarted(windowId) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      if (!state.entry || !state.ids.includes(windowId)) return null;
      const id = `scan:${randomId()}`;
      const ids = [...state.ids, id];
      await this.#writeHolders(state.entry, ids);
      await this.#session.set({ [LAST_INPUT_STORAGE_KEY]: state.now });
      await this.#settle({ ...state, ids, lastInputAt: state.now });
      return id;
    });
  }

  // The user typed, clicked, scrolled or moved the pointer, at the time given and no later than now, in a window or
  // scan that holds the unlock.
  input(holderId, at) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      if (!state.ids.includes(holderId)) return;
      const time = Number.isSafeInteger(at) ? Math.min(at, state.now) : state.now;
      if (pastTime(state.lastInputAt, state.now) && time <= state.lastInputAt) return;
      await this.#session.set({ [LAST_INPUT_STORAGE_KEY]: time });
      await this.#settle({ ...state, lastInputAt: time });
    });
  }

  // The end of a scan. With a picked code the unlock is handed on to the popup or Add code window that shows it;
  // a cancelled or failed scan hands nothing on.
  scanEnded(scanId, picked) {
    return this.#exclusive(async () => {
      const state = await this.#read();
      if (!state.ids.includes(scanId)) return;
      let handoff = state.handoff;
      if (picked) {
        handoff = { sessionId: state.entry.sessionId, to: 'any', until: state.now + HANDOFF_MS };
        await this.#session.set({ [HANDOFF_STORAGE_KEY]: handoff });
      }
      await this.#settle(await this.#leave({ ...state, handoff }, scanId, true));
    });
  }

  // A code is about to go into a page from the context menu, without an extension window. Resolves to whether the
  // unlock still holds; if it does, the fill counts as use: input in the windows that hold the unlock, or, with none,
  // a new close, from which a timed unlock counts again.
  use() {
    return this.#exclusive(async () => {
      const state = await this.#read();
      const held = state.ids.length > 0;
      if (!state.entry || unlockEnded({ ...state, held })) {
        await this.#settle(state);
        return false;
      }
      if (held) {
        await this.#session.set({ [LAST_INPUT_STORAGE_KEY]: state.now });
        await this.#settle({ ...state, lastInputAt: state.now });
      } else {
        await this.#session.set({ [CLOSED_STORAGE_KEY]: state.now });
        await this.#settle({ ...state, closedAt: state.now });
      }
      return true;
    });
  }

  // An alarm fired or the stored unlock changed: decide again from what is stored.
  check() {
    return this.#exclusive(async () => this.#settle(await this.#read()));
  }
}
