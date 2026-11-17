<p align="left"><img src="public/icon/logo.svg" width="56" height="56" alt="LinkGuard"></p>

# LinkGuard

Find broken links, inspect rendered pages, and export clear results directly from Firefox.

## Features

- Quick HTTP availability scan for the current page.
- Deep scan that also inspects loaded HTML, JSON and text content.
- Site crawl for a domain and its subdomains, with robots.txt support.
- Broken, unverified, internal and external filters.
- Page highlighting, copyable results and CSV export.
- 23 interface language variants.

LinkGuard distinguishes a confirmed broken URL from an uncertain result. A successful
HTTP response alone cannot prove that a page is usable.

## Build

Requires Node.js 24+ and npm.

```sh
npm ci
npm run build
```

For a temporary Firefox install, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then
select `.output/firefox-mv3/manifest.json`.

For a Chromium preview:

```sh
npm run build:chrome
```

Open `chrome://extensions`, `edge://extensions`, or `brave://extensions`,
enable Developer mode, choose **Load unpacked**, and select
`.output/chrome-mv3`.

## Checks

```sh
npm run check
npm test
npm run test:popup:all
npm run validate:firefox
```

The automated tests use controlled browser and network substitutes. Test the full
experience in Firefox before each release.

## Privacy and permissions

LinkGuard has no account, analytics service, or scan backend. A user-requested scan
sends each URL directly to the destination website. Browser checks may use the
user's normal website session, but LinkGuard never reads or exports cookie values,
submits forms, or bypasses logins and CAPTCHAs.

See [Firefox release notes](docs/AMO.md), [checking algorithm](docs/ALGORITHM.md),
[supported languages](docs/LANGUAGES.md), and [manual Firefox scenarios](docs/FIREFOX.md).

## License

MIT for project code. The bundled Public Suffix List data is MPL-2.0; see
[third-party notices](THIRD_PARTY_NOTICES.md).
