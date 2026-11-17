# Chrome, Edge and Brave preview

LinkGuard now builds a separate Chromium Manifest V3 package. Firefox remains the
primary target; Chromium support is a preview pending real-browser acceptance.
Minimum API target: Chromium 120. Use a current supported browser release.

## Install locally

```sh
npm ci
npm run build:chrome
```

1. Open `chrome://extensions`, `edge://extensions` or `brave://extensions`.
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select `.output/chrome-mv3`, the directory containing `manifest.json`.
4. Open an ordinary web page, pin LinkGuard and start a scan.

For the packaged version, extract `artifacts/linkguard-chromium.zip` and choose
that extracted directory. Keep the directory in place. This is an unpacked preview,
not a Chrome Web Store or Edge Add-ons release. Browser restart behavior and update
installation differ from Firefox's temporary add-ons. Safari is not targeted.

## Differences from Firefox

- WXT generates a service worker instead of `background.scripts`.
- There are no Gecko manifest fields or Firefox container/cookie permissions.
- The same scanning, search, filtering, export, language and highlighting code runs.
- Session results survive popup closure. If the background worker is terminated,
  partial results are retained and marked interrupted on reopening; unfinished jobs
  do not automatically resume. A browser termination during deep checking can leave
  a checking tab to close manually. No persistent keep-alive service is used.
- Private/incognito browsing is disabled in both builds.

## Acceptance scenarios

Use `npm run fixture` and the scenarios in [FIREFOX.md](FIREFOX.md), adapting the
installation step. Check these additions in each target browser:

- A scan starts without asking for cookie permission.
- Close the popup during a slow scan, then reopen it. Results should remain available.
- Stop a deep scan; no new checking tabs should start and inactive owned tabs close.
- Explicitly terminate the service worker during a scan via extension developer tools;
  reopen the popup and confirm interrupted partial results rather than a false completion.
- Revoke site access, then verify a clear error and no requests until access is granted.
- Search by URL and HTTP status; combine search with Unverified/Internal/External.
  Copy and CSV must contain only the resulting view. Escape clears the search.
- Check CSV downloads, real clipboard, keyboard focus, 380 px layout and both themes.
- Browser pages and protected extension stores should fail without pretending to scan.

## Automated checks

`npm run test:popup:all` builds and executes both production popup bundles against
mock browser APIs. The Chrome test supplies `chrome` without a Firefox `browser`
global. The background suite also runs with both permission configurations. These
are compatibility checks, not real-browser integration tests.

Official references:
[Chrome unpacked installation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world),
[Edge sideloading](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading),
[WXT browser targeting](https://wxt.dev/guide/essentials/target-different-browsers.html),
[Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Other browser candidates

The next desktop candidates are Vivaldi, Opera and Yandex Browser. This is a
compatibility direction, not a claim that LinkGuard has passed tests in them.
They can use Chrome/Chromium extension formats, but API behavior and installation
policies still need checking. Reuse the Chromium build as the starting point;
do not create three nearly identical codebases.

- [Vivaldi](https://help.vivaldi.com/desktop/appearance-customization/extensions/) documents loading unpacked extensions and notes that behavior can differ from Chrome.
- [Opera](https://help.opera.com/en/extensions/) documents its Chromium-based extension platform; verify the needed APIs in the installed release.
- [Yandex Browser](https://yandex.com/support/browser/en/personalization/extension.html) supports extensions from Chrome/Opera catalogs and applies its own installation checks.
- [Safari](https://developer.apple.com/safari/extensions/) needs separate Apple packaging and API compatibility work. There is no tested Safari build in this project.

These references were checked November 16, 2026. Mobile browsers need their own
layout, permissions and temporary-tab acceptance; desktop support is not evidence
of mobile support.
