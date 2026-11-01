# Home-screen web app (iPhone, no Mac needed)

`web/` is a version of Police HQ that installs from Safari with **Share › Add to Home Screen**. It opens full screen like an app, works in airplane mode, and reads the same signed `.phqpkg` content package as the native app. It needs no Mac, no Xcode and no Apple Developer account.

## Publish it

1. Copy the repository to GitHub, including `web/`, `index.html` and `.nojekyll` at the top level.
2. On GitHub, go to **Settings › Pages** and choose **Deploy from a branch**, branch `main`, folder **/ (root)**.
3. After a minute or two, open `https://<account>.github.io/<repo>/`. The page at the top level forwards to `/web/`.

The site holds **only the app**: no legal text, no package and no keys. Each phone imports the package itself, so it is never posted on the public site.

## Publish the content from your computer (optional)

So that phones download the content by themselves, publish the package on the same site:

```bash
cd tools
python -m phq_ingest.web_publish --pkg /path/to/PoliceHQ-content-2026.11.01-dev.phqpkg --out ../web/content
```

This writes `web/content/latest.json` and `package.part01`, `package.part02` and so on, each 20 MB or smaller. The size keeps each part under GitHub's 25 MB limit for uploads through the browser. Commit or upload the whole `web/content/` folder. For a new content version, run the command again and replace the folder.

**This makes the package public** if the repository and its Pages site are public (free GitHub Pages sites are). That includes the municipal by-laws. See [REDISTRIBUTION.md](REDISTRIBUTION.md). If they must stay private, skip this section and import the file on each phone instead.

The parts aren't trusted on their own. The app joins them, then runs the full signature and per-file hash check before installing anything.

## Install it on an iPhone

1. Open `https://<account>.github.io/<repo>/web/` in **Safari**. Chrome and other browsers on iPhone can't add a full-screen web app.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Police HQ** from the home screen.
   - **If content is published on the site:** the download starts by itself (87 MB; Wi-Fi recommended). Keep the app open until it says the content was installed.
   - **If not:** put the `.phqpkg` file on the phone (AirDrop › Save to Files, or iCloud Drive). Then go to **Settings › Import content package** and choose the file.
4. Test it: turn on Airplane Mode, close the app, and reopen it.

Install the content **inside the home-screen app**, not in a Safari tab, because iOS keeps the home-screen app's storage separate from Safari's. In a Safari tab, the download waits for you to tap the button.

When a newer package is published, the Home screen shows "New content available". You install it from Settings, and the previous package stays available for rollback.

## How it works

| Part | Implementation |
|---|---|
| App shell | Plain HTML, CSS and JavaScript modules, with no build step and no third-party requests. A service worker caches the app so it opens offline. |
| Database | The package's `content.sqlite`, run on the phone with the official SQLite WebAssembly build (`web/vendor/sqlite3.*`, 3.54.1, FTS5 included). It's stored in the Origin Private File System (opfs-sahpool VFS) inside a Web Worker. If that's unavailable, it falls back to browser storage, which is slower to start. |
| Content from the site | `web/content/latest.json` lists the parts. The app downloads only when there's no content and you're in the home-screen app, or when you tap Install. It checks for a newer version when it opens online. |
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
- **Content:** run `web_publish` again and upload the new `web/content/`, or import a newer `.phqpkg` under Settings. A package signed with a key that isn't in `web/js/trusted-keys.js` is rejected.

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
