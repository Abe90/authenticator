import { UserError } from '../core/user-error.mjs';

// Every text the user sees comes from _locales, in the language Firefox chose for the extension: the system's, or
// English. t(key, ...values) is the message key, with values in place of its $1, $2…
export const t = (key, ...values) => browser.i18n.getMessage(key, values.map(String));

let rules = null;

// "1 code", "2 codes": the message key_one, key_other or another plural category of the language, with the count as
// $1 and values from $2. A language whose messages lack the category gets key_other.
export function plural(key, count, ...values) {
  // The language of the messages, which each messages.json names, not the system's.
  rules ??= new Intl.PluralRules(t('locale'));
  return t(`${key}_${rules.select(count)}`, count, ...values) || t(`${key}_other`, count, ...values);
}

// The text of a failure: its own for an error meant for the user, anything else gets fallback.
export const errorText = (error, fallback) => (error instanceof UserError ? t(error.key, ...error.values) : fallback);
