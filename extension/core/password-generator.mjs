// A suggested vault password: 20 characters picked at random from letters, digits and symbols, at least one of each.
const SETS = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!#$%&()*+,-./:;<=>?@[]^_{|}~'];
const ALL = SETS.join('');
export const SUGGESTED_LENGTH = 20;
// The largest multiple of the alphabet that a byte holds: values from here up are drawn again, so that no character
// comes up more often than another.
const LIMIT = Math.floor(256 / ALL.length) * ALL.length;

// random(values) fills a Uint8Array, as crypto.getRandomValues does.
export function suggestPassword(random = (values) => crypto.getRandomValues(values)) {
  const value = new Uint8Array(1);
  for (;;) {
    let password = '';
    while (password.length < SUGGESTED_LENGTH) {
      random(value);
      if (value[0] < LIMIT) password += ALL[value[0] % ALL.length];
    }
    if (SETS.every((set) => [...password].some((character) => set.includes(character)))) return password;
  }
}
