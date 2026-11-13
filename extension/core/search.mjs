import { displayHost, validSites } from './sites.mjs';

// Searching the lists of accounts: a query finds an account by its name or by one of its sites, as stored or as the
// pages show it (readable, for a name in another script), whatever the case.

// What a search looks in for account, in lower case.
export function searchText(account) {
  const hosts = validSites(account.sites).flatMap(({ host }) => {
    const shown = displayHost(host);
    return shown === host ? [host] : [host, shown];
  });
  return [account.name, ...hosts].join('\n').toLocaleLowerCase('en');
}

// What the user typed, as searchText compares it.
export const searchQuery = (text) => text.trim().toLocaleLowerCase('en');

// An account as the lists for filling a field take it: only what they show and search.
export const searchEntry = (account) => ({ id: account.id, name: account.name, search: searchText(account) });
