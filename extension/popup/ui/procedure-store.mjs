import { PROCEDURE_KEY } from '../../core/storage-keys.mjs';

// The procedure the popup was in, kept in storage.session, so that a popup that closed while the user copied or
// pasted a key elsewhere goes on from there. It goes when the unlock ends (core/auto-lock.mjs); the setup's, which
// comes before any vault, when Firefox closes. onError() tells that a procedure could not be forgotten.
export function procedureStore(storage, { onError = () => {} } = {}) {
  // Rejects when storage.session refuses.
  const clear = () => storage.remove(PROCEDURE_KEY);

  // The end of a procedure, or its exit: forgets it, then runs then(...args). A procedure that could not be
  // forgotten is reported once then() has finished, not taken for forgotten.
  async function leave(then, ...args) {
    const cleared = await clear().then(() => true, () => false);
    const result = await then(...args);
    if (!cleared) onError();
    return result;
  }

  return {
    // A New recovery key whose key the vault already has was finished by a popup that closed before forgetting it:
    // it does not start again.
    async load(vault) {
      const { [PROCEDURE_KEY]: state } = await storage.get(PROCEDURE_KEY).catch(() => ({}));
      if (!state || typeof state.run !== 'string') return null;
      if (state.run === 'recovery' && await vault.checkRecoveryKey(state.key).then(() => true, () => false)) {
        await leave(() => {});
        return null;
      }
      return state;
    },
    save: (state) => storage.set({ [PROCEDURE_KEY]: state }).catch(() => {}),
    clear,
    leave,
    forget: () => leave(() => {}),
  };
}
