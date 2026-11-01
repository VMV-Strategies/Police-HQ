# Home-screen web app (iPhone, no Mac needed)

`web/` is a version of Police HQ that installs from Safari with **Share › Add to Home Screen**. It opens full screen like an app, works in airplane mode, and reads the same signed `.phqpkg` content package as the native app. It needs no Mac, no Xcode and no Apple Developer account.

## Publish it

1. Copy the repository to GitHub, including `web/`, `index.html` and `.nojekyll` at the top level.
2. On GitHub, go to **Settings › Pages** and choose **Deploy from a branch**, branch `main`, folder **/ (root)**.
3. After a minute or two, open `https://<account>.github.io/<repo>/`. The page at the top level forwards to `/web/`.

The site holds **only the app**: no legal text, no package and no keys. Each phone imports the package itself, so it is never posted on the public site.

## Install it on an iPhone

1. Open `https://<account>.github.io/<repo>/web/` in **Safari**. Chrome and other browsers on iPhone can't add a full-screen web app.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Police HQ** from the home screen. It says "No content installed".
4. Put `PoliceHQ-content-….phqpkg` on the phone, for example with AirDrop (Save to Files) or iCloud Drive.
5. In the app, go to **Settings › Import content package** and choose the file. It's checked, then installed; this takes seconds to a minute.
6. Test it: turn on Airplane Mode, close the app, and reopen it.

Import the package **inside the home-screen app**, not in a Safari tab. iOS keeps the home-screen app's storage separate from Safari's.

## How it works

| Part | Implementation |
|---|---|
| App shell | Plain HTML, CSS and JavaScript modules, with no build step and no third-party requests. A service worker caches the app so it opens offline. |
| Database | The package's `content.sqlite`, run on the phone with the official SQLite WebAssembly build (`web/vendor/sqlite3.*`, 3.54.1, FTS5 included). It's stored in the Origin Private File System (opfs-sahpool VFS) inside a Web Worker. If that's unavailable, it falls back to browser storage, which is slower to start. |
| Package import | Every check the Swift app makes: magic and index, safe paths, an **Ed25519 signature** over `manifest.json` against `web/js/trusted-keys.js` (noble-ed25519), format, schema and minimum app version, no missing or unlisted files, and the **SHA-256 and size of every file**. The package is read in slices, so it's never fully loaded into memory. |
| Atomic install and rollback | Two slots (A and B). A new package goes into the unused slot, then the install state is switched in a single write. A failed or rejected import leaves the package in use untouched. The previous package stays available for **Roll back** until you delete it. |
| Originals | The PDFs and Word files are stored on the phone. PDFs open in the browser. Word files are opened through Share or Save. |
| Your records | Bookmarks, saved searches and the explanation-level setting are kept in IndexedDB on the phone. |

## What's included and what isn't

Included, with the same rules as the native app:

- Statutes browser with level and municipal filters.
- Document reader: contents, jump to section, **Search this document** with match navigation, page text for heuristic and OCR sources, bookmarks, originals, and currency, verification and reproduction notices.
- **Search all sources** (keywords, exact phrase, section number; level and municipality filters; not-yet-in-force text excluded by default) and saved searches.
- Authorities hub (six categories), Rights hub by stage, Cautions library ("Approved wording not installed."), offence guides and checklists.
- Four explanation levels that never change the quoted wording.
- Penalties and points panel ("Total cannot be verified.", and missing amounts are never shown as $0).
- Coverage gaps, content status, import, rollback, and erase.

**Not in the web version:**

- The **Situation workspace**: saved situations, the elements matrix, evidence, hypotheses and the rights timeline. Saving situation records needs the encrypted, Keychain-backed storage of the native app; a web page can't protect them the same way. The Home screen offers "Find guides" instead. It matches keywords against the guides and saves nothing.
- **On-device AI.** No assistant runs in the web version, and nothing is ever sent to a cloud model.
- Checklist completion tracking. Checklists are shown for reference only.
- Training scenarios.

## Updating

- **App:** push changes and bump `VERSION` in `web/sw.js`. Phones that are online pick up the new version and show "An update to the app is ready".
- **Content:** import a newer `.phqpkg` under Settings. A package signed with a key that isn't in `web/js/trusted-keys.js` is rejected.

## Limits to know

- iOS can clear storage for websites you don't use. Home-screen apps are exempt from Safari's 7-day clearing, and the app also requests persistent storage. Settings shows whether persistence was granted.
- Two installed packages (the current one plus a rollback copy) use about 340 MB. Settings › Delete previous package frees about half of that.
- Only one copy of the app can hold the database at a time. If it's also open in a Safari tab, close the tab.

## Testing

`web/tests/e2e.js` drives the app in a phone-sized Chromium with Playwright (see the comments in the file). On 2026-11-01 it passed 30 of 30 checks against the real development package, covering:

- import in about 2 seconds
- rejection of a tampered file and a tampered manifest, with the current package kept
- offline reload
- the Brampton filter
- the reader at Criminal Code s. 495(1), search in the document, and contents navigation
- search across all sources
- the six authority categories
- caution wording shown as not installed at every level
- the speeding statutory amount ($112.50 for 25 km/h over) with "Total cannot be verified."
- bookmarks
- no requests leaving the site
- no console errors

**It has not been run on a real iPhone or in Safari.** Use the airplane-mode steps above and the web items in [DEVICE_ACCEPTANCE_CHECKLIST.md](DEVICE_ACCEPTANCE_CHECKLIST.md).
