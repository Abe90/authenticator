import { PROCEDURE_KEY } from '../../core/storage-keys.mjs';

// The procedure the popup was in, kept in storage.session until Firefox closes, so that a popup that closed while
// the user copied or pasted a key elsewhere goes on from there.
export function procedureStore(storage) {
  const clear = () => storage.remove(PROCEDURE_KEY).catch(() => {});
  return {
    async load() {
      const { [PROCEDURE_KEY]: state } = await storage.get(PROCEDURE_KEY).catch(() => ({}));
      return state && typeof state.run === 'string' ? state : null;
    },
    save: (state) => storage.set({ [PROCEDURE_KEY]: state }).catch(() => {}),
    clear,
    // The end of a procedure, or its exit: forgets it, then runs then(...args).
    async leave(then, ...args) {
      await clear();
      return then(...args);
    },
  };
}
