# Authenticator for Firefox

A two-factor authentication app that lives in Firefox. It generates the six-digit codes that websites ask for at sign-in (TOTP and HOTP, the same codes as Google Authenticator), from an encrypted vault on your computer. Signed in to Firefox, you find the same codes on every computer through Firefox Sync.

There is no account and no server: the extension collects nothing, and the only data that leaves your computer is the encrypted vault, carried by your own Firefox Sync. It is plain HTML, CSS and JavaScript modules, with no build step and no runtime dependency.

## Install

Get it from addons.mozilla.org: **https://addons.mozilla.org/firefox/addon/authenticator-vault/** (Firefox 153 or later).

## Features

- **Codes on every computer.** Sign in to Firefox with the same Mozilla account and keep **Add-ons** checked in the Sync settings: Firefox installs the extension on your other computers too. The first computer creates the vault; on the others choose **I use it on another computer** and enter the same password. Without an account the vault stays on the computer.
- **Time-based (TOTP) and counter-based (HOTP) codes**, SHA-1, six digits, 30-second period. Counter-based accounts work as in Google Authenticator: they show dashes until you press the button next to the code, which advances the counter and shows the new code.
- **Copy with a click.** Click an account, or press Enter or Space on it, to copy its code.
- **Add accounts** from the round + button:
  - **Scan a QR code** finds the QR codes on the web page you are on: the page is dimmed except for the codes, you click one, check the name and press **Add**.
  - **Enter a setup key** opens a window for a name and a Base32 key, or for a QR code from an image file or a pasted screenshot.
  - `otpauth://` links and Google Authenticator exports (`otpauth-migration://`) are read too; from an export you choose which accounts to keep. A key already in your list is not added twice.
- **Fill in a code from the page.** Right-click the field that asks for the code and choose **Authenticator**. When one account belongs to the site, its code goes straight into the field, also when the field is split into six boxes; otherwise the names of your accounts show under the field, the site's first, and the one you choose fills it (with the mouse, or the arrow keys and Enter; with more than 10 accounts, a search field finds them by name or by site). With the vault locked, the popup asks for the password first, then lists the accounts the same way; so it does when the page leaves no room for the list. Where the extension cannot reach the field (Mozilla's own sites, the PDF viewer, a frame of another origin), or the field cannot take a code (read-only, disabled, or an editable area that is not a field), the popup opens on the list, which copies.
- **Sites.** Each account remembers the websites it belongs to: the page you scanned its QR code on, the tab where you opened **Enter a setup key**, and every site where you chose it from the field's menu, except in private windows. **Edit** shows them and lets you add or remove them, up to ten per account. A site covers all its subdomains: `accounts.google.com` and `myaccount.google.com` are one site, while `mario.github.io` and `luigi.github.io` are two.
- **Organise** your accounts: search them by name or by site, edit their name and sites or remove them from the right-click menu, and drag them (or press Alt+Up and Alt+Down) to change the order.
- **Password lock.** The vault locks 5 minutes after the popup closes, after the last code filled in from a page, or after 5 minutes without using an open Authenticator window, or when you choose in Settings: as soon as the popup closes (an open window then locks after 1 minute without use), after 1 or 30 minutes or 1 hour, or never until Firefox closes. **Lock now** locks it at once. **Suggest a password** fills in 20 random letters, digits and symbols.
- **Read-only codes when something is wrong.** If the vault in Firefox Sync is damaged or replaced, or another vault claims to be older, your password still opens your codes read-only, without writing anything to Firefox Sync.
- **Recovery key.** Shown once when the vault is created; with it, **Forgot password?** sets a new password.
- Light and dark themes that follow Firefox's.
- In English, French, German, Spanish and Italian, following Firefox's language.

Not supported: SHA-256 or SHA-512, eight-digit codes, periods other than 30 seconds, the camera, and backup files.

## How it works

### The vault

Each account is stored as its own encrypted item in `browser.storage.sync`. Accounts are sealed with AES-256-GCM under a random 256-bit vault key, with a fresh IV on every write. The vault key itself is stored twice, wrapped with a key derived from your password (PBKDF2-SHA256, 600,000 iterations) and with one derived from the recovery key. Neither the password nor the recovery key is ever stored.

Unlocking unwraps the vault key and keeps it in `browser.storage.session`, which lives in memory until Firefox closes; locking removes it, and the background script removes it when the time chosen in Settings is up, even with no extension window open. Every read and write checks that the key still opens the vault. Codes are computed on the computer from the decrypted keys, as RFC 4226 and RFC 6238 describe.

### Sync between computers

Firefox Sync carries `browser.storage.sync` between your computers, encrypted again end to end, every 10 minutes or on **Sync now**. Each change writes only the accounts it touches, so changes made on different computers merge.

Removing a Firefox extension deletes its sync data on every computer. To survive that, each computer keeps a copy of the encrypted vault in `browser.storage.local`. When the vault disappears from sync, the copy is kept aside and **Restore this computer's copy** puts it back after its password, with the codes you choose; it never goes back on its own, since an old copy could bring back a password changed since. A vault created on a computer before it was connected to Firefox Sync is offered after the next unlock, to copy its codes into the main vault; it stays until you remove it from Settings. A counter-based code never goes back to an older counter.

### Sites and filling in a code

The sites of an account are stored inside its encrypted item, as a list of hosts. A page belongs to an account when its registrable domain, from Firefox's own Public Suffix List, is that of one of the account's sites; IP addresses and local names such as `router.lan` match only themselves.

Choosing **Authenticator** in a field's menu lets the extension inject a small script into that tab only. The script finds the field you clicked and puts the code in, as typing would; the page never sees a key, an account name or the password, and the code never goes through the clipboard. Nothing is ever filled in without that click, and a form is never submitted.

The names under the field are an extension page in a frame, inside a closed shadow root in the top layer: the page can neither read nor reach it, nor learn its address. The names go only to the frame made for that click, which proves it with a one-time token. A choice counts only when the list was there to be seen at the point of the click, and not within half a second of appearing or moving; the list goes back on top of anything the page puts over it, and closes when the page changes or removes it.

### Format of the vault

Reading an account keeps every field, known or not, and writing it puts back the fields this version does not know. A new field is always optional, with a default when missing; a field is never renamed and never changes type or meaning. An unknown field never makes an account unreadable, and the format version stays the same, since additions need no new one. Lists hold objects, so that their entries can gain fields too. A vault saved by a later version therefore opens and changes here without losing what that version added. Every computer that syncs the vault needs a version with sites: an older one drops them from the accounts it changes.

### Scan a QR code

When you choose **Scan a QR code**, the extension injects a small script into the current tab, takes a screenshot of the visible page and decodes the QR codes in it, all inside Firefox. The script in the page only learns where the codes are, to draw the holes in the dimmed page; it never sees the image or the decoded keys.

## Privacy and permissions

The extension has no server, sends nothing and collects nothing. QR codes are decoded on the device. A script enters a page only when you ask: with **Scan a QR code**, or with the **Authenticator** item of a field's menu.

| Permission | Why |
|---|---|
| `storage` | The encrypted vault, its local copy and the unlock settings. |
| `clipboardWrite` | Copying a code. |
| `alarms` | Locking the vault when its time is up, also with no extension window open. |
| `activeTab`, `scripting` | Scan a QR code and filling in a code: they apply only to the tab where you clicked the extension's button or its menu item, until it loads another page. |
| `menus` | The **Authenticator** item in the menu of editable fields. |
| `publicSuffix` | Telling which hosts are the same site, with Firefox's own Public Suffix List. |

Firefox's sync storage holds 100 KB per extension: around 450 typical accounts, or 380 with one site each.

## Development

The project needs only Firefox and Node.js 22.18 or later, with no packages to install. It has no automated tests: changes are tried by hand in Firefox.

```bash
node tools/check.mjs     # static checks
node tools/package.mjs   # builds the archives in dist/
```

`tools/check.mjs` checks text hygiene and syntax, follows the manifest through HTML, CSS, imports and asset paths, so that every file the extension loads exists and is packaged, and checks that every text the extension shows is in each language of `extension/_locales`. `tools/package.mjs` builds, from committed files, the archive to upload to Mozilla and a source archive that reproduces it; both are reproducible byte for byte.

### Run it from the source

To try a change, load the folder as a temporary add-on:

1. Open Firefox 153 or later and go to `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…** and choose `extension/manifest.json`.
3. Open **Authenticator** from the extensions menu, choose **Create a new vault**, set a password and add the public test key `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` (never use it for a real account). As a counter-based key, its button gives `287082`, then `359152`.

A temporary add-on is removed when Firefox closes, and Firefox Sync then removes its vault from your other computers too, unless one of them still has the extension.

### Project structure

```
extension/          what Firefox loads; the upload archive contains its files
  manifest.json
  _locales/         the texts, one messages.json per language
  popup/            the toolbar popup, also the Add code window (popup.html?view=add) and the list under a field (bubble.html)
    ui/             one module per part of the page
  background/       background scripts: Scan a QR code, the field's menu item, the local copy of the vault, the lock timer
  content/          the scripts injected into a page: the picker of Scan a QR code, the list under a field
  core/             OTP generation, QR payload parsers, the encrypted vault
  shared/           what the popup and the background share: the texts, the QR decoder and its worker, the filling of a field
  assets/           fonts and icons
  vendor/jsqr/      the bundled QR decoder
tools/              the static check and the packager
```

## License

Authenticator is released under the Mozilla Public License 2.0, see `LICENSE`.

Bundled third-party components keep their own licenses: [jsQR](https://github.com/cozmo/jsQR) 1.4.0 (Apache-2.0) in `extension/vendor/jsqr/`, and the Google Sans font (SIL Open Font License) in `extension/assets/fonts/`. The icons named `firefox-*.svg` are Firefox's own icons, under the Mozilla Public License 2.0.
