# Contributing to LinkGuard

Keep the interface simple and the evidence honest. A change is useful when it
improves a real link check, not merely when it adds another heuristic.

## Set up

Use Node.js 22.18+ and npm. Run:

```sh
npm ci
npm run check
npm test
npm run test:popup:all
npm run validate:firefox
```

Use `npm run dev` for Firefox development. `npm run fixture` starts local HTTP
cases for the manual Firefox scenarios in `docs/FIREFOX.md`.

## Report a checking error

Include the browser version, operating system, scan mode, expected outcome,
observed outcome and reproduction steps. A public URL or a small local fixture
helps. Never post passwords, cookies, tokens, private page text or private URLs.

## Make a change

Keep patches focused. Preserve cancellation, bounded concurrency, explicit
uncertainty and compatibility with stored scan results. For classifier changes,
add both a failure example and a similar legitimate page to the tests. Do not
report synthetic test accuracy as accuracy across the web.

Update all selectable locale dictionaries when adding interface text.
Translations need native-speaker review.

## Project map

- `lib/`: URL handling, HTTP/content checks, browser inspection and crawl queues.
- `entrypoints/`: background orchestration and the Svelte popup.
- `locales/`: interface dictionaries.
- `tests/`, `scripts/firefox-fixture.mjs`: automated and manual scenarios.

The GitHub templates are ready for the public repository. Until an issue tracker
is configured, no project contact address is implied.
