# How LinkGuard checks links

Quick mode checks HTTP availability. Deep mode adds content evidence and browser
inspection. Site mode applies the same deep checks to a bounded breadth-first crawl.

## A streaming pipeline

1. Normalize HTTP(S) URLs and deduplicate them. Preserve common SPA hash routes.
2. Read HTTP responses with finite time and byte budgets. Parse HTML without
   executing it; validate complete JSON/plain-text resources where supported.
3. Feed eligible HTML directly into a shared browser queue while other HTTP
   requests continue. Static positive HTML evidence remains provisional.
4. Open a temporary inactive tab in the source browser window (and Firefox container, when granted). Observe
   its main-document response and inspect rendered content repeatedly.
5. Compare URL, headings, normalized text, media and loading indicators across
   observations. An empty main region does not borrow text from a sidebar.
6. Save a result with its reason. Preserve the original request status separately
   from the observed browser navigation status. Close only owned inactive tabs.

HTTP work is limited to 16 active tasks and 4 per origin; browser work to 2 tabs
and 1 per origin, shared across scans. Deep mode permits at most two HTTP attempts
inside a 20-second active budget. Quick mode allows 12 seconds per request, up to
24 seconds when a HEAD response needs GET confirmation. Browser observation has an 18-second budget, three matching
observations and a normal minimum settling period of 2 seconds. Queue time is extra.
Retry-After controls a request's retry, not all requests to the origin.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| Working | Supported content evidence was found; HTML also passed browser observation. |
| Broken | A confirmed non-restricted HTTP error such as 404 or 410 was observed. |
| Restricted | Login, access restrictions, a challenge, or rate limiting prevents verification. |
| Unverified | The available evidence is insufficient or ambiguous. |

The quick-mode positive label is **Server responds**, not **Working**. A browser
404 is not overridden by a large, readable page body. An unavailable navigation
status stays unknown rather than being fabricated. A failed render cannot leave a
provisional HTML result green.

## Site traversal

Crawling stays within a registrable domain and its subdomains, using the Public
Suffix List including PRIVATE entries. Ports are constrained; unknown suffixes,
IP addresses and localhost use exact-origin boundaries. External targets are
checked without expanding their outgoing links.

Defaults: 1,000 unique URLs, depth 5, 20 query/hash variants per origin/path,
20 source references per result. Cycles are deduplicated. robots.txt is cached per
origin for the scan; restrictive and unavailable responses are handled conservatively.
Obvious action URLs are skipped. No forms or CAPTCHA prompts are submitted.

## What this cannot prove

The algorithm cannot guarantee that a page contains the intended information, that
its business features work, or that it will not change after observation. Error
recognition is heuristic. The regression corpus is not a random public-web accuracy
benchmark. Iframes, closed shadow roots, ordinary anchors and binary documents are
outside deep content verification. Lean experiments have not been compiler-verified
and do not establish correctness of these heuristics.

The complete implementation notes are currently available in Russian in
[DEEP-CHECK.md](DEEP-CHECK.md).

## Quick-scan confirmation and uncertainty

HEAD can be implemented differently from GET. A quick check now performs a bounded
GET fallback on HEAD 400/403/404/405/410/501, cancelling the body rather than parsing
it. A HEAD 404 followed by GET 200 is a responding server; GET 404/410 confirms the
failure. If the confirming request fails, the result stays unverified. A HEAD 429
is not immediately retried. HTTP 5xx is unverified in quick/deep results, since a
server failure does not establish that the URL is permanently missing.

This does not detect soft errors in quick mode; deep checks still supply content
and browser evidence. No new calibration requests or guessed site-specific APIs
are sent. Explicit action URLs are skipped before either mode issues a request.
