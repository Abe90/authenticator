// An error whose text the user sees. Its key names a message of _locales and values fill the message's $1, $2…;
// the text is chosen where it is shown (shared/i18n.mjs errorText), so that this folder also runs outside Firefox.
export class UserError extends Error {
  constructor(key, ...values) {
    super(key);
    this.name = 'UserError';
    this.key = key;
    this.values = values;
  }
}
