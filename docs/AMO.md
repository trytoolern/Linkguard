# Publishing on Mozilla Add-ons

This repository contains the Firefox Desktop extension source. It does not
contain deployment infrastructure, payment software, credentials or any website
source.

## Before submitting

1. Use Node.js 24 and run `npm ci`.
2. Run `npm run release:check`.
3. Run `npm run build` and upload the resulting Firefox package to the Mozilla
   Developer Hub. Upload the repository source archive when Mozilla requests it.
4. Select Firefox Desktop only. This release is not declared compatible with
   Firefox for Android.
5. Supply the real homepage, privacy-policy and support-contact details in AMO.
   Do not invent contact information or claim language coverage that has not been
   reviewed by speakers.

## Listing facts

LinkGuard checks links only after the user starts a scan. It sends the link URL
directly to the destination site to perform that check; it has no LinkGuard
account, analytics service or collection endpoint. Deep checks may open a
temporary tab in the user's browser session, therefore page scripts and normal
session cookies can run. The extension never reads or exports cookie values.

HTTP 200 alone does not prove that a page or an application workflow works.
CAPTCHA, login pages, rate limits and ambiguous content are kept distinct from a
confirmed broken link. LinkGuard is not a malware scanner.

## Reviewer instructions

From a clean checkout run `npm ci`, `npm run build` and load
`.output/firefox-mv3/manifest.json` through `about:debugging`. Run
`npm run fixture` for local HTTP cases and follow `docs/FIREFOX.md`. The build
requires no credentials, environment variables or private registry.

`websiteContent` is declared because page links are sent to their destinations
during a user-requested scan. `webRequest` observes HTTP status only for the
extension's own checking tabs. The optional `cookies` permission selects the
source Firefox container; cookie values are not accessed. No remote extension
code is loaded.

Check Mozilla's current submission and policy documentation on the actual
submission day: [submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) and [add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
