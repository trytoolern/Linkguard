import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml } from '../lib/content.ts';
import { checkDeepLink, retryDelay } from '../lib/deep-checker.ts';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const link = { url: 'https://example.com/a', kind: 'internal' as const, count: 1 };
const article = '<title>Guide</title><main><h1>Useful guide</h1><p>This is a complete useful article with actual content.</p></main>';
const response = (text = article) => new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
test('recognizes content while treating error pages, authentication and app shells conservatively', () => {
  const cases = [
    [article, 'present'],
    ['<main><h1>How to fix a 404 error</h1><p>This article explains how HTTP errors work.</p></main>', 'present'],
    ['<title>404 - Not found</title><h1>Page not found</h1><p>Sorry, we cannot find your page.</p>', 'suspected-error'],
    ['<h1>Страница не найдена</h1><p>Попробуйте поискать другую страницу.</p>', 'suspected-error'],
    ['<title>Just a moment...</title><p>Verify you are human before you continue.</p>', 'challenge'],
    ['<h1>Sign in</h1><input type=password><p>Enter your username and password to continue.</p>', 'login'],
    ['<nav>A long menu with many navigation links</nav><div id=root></div><script>fetch("https://invalid.test")</script>', 'needs-browser'],
    ['<div hidden>Very long hidden text is not visible content.</div>', 'empty'],
    ['<div style="display:none">Very long hidden text is not visible content.</div>', 'empty'],
    ['<div class=cookie-banner>Please accept our cookies before using this site.</div>', 'empty'],
    ['<img src=/photo.jpg>', 'unverified'],
    ['<form><input name=search></form>', 'unverified'],
    ['<p>OK</p>', 'unverified'],
    ['', 'empty'],
  ];
  for (const [html, state] of cases) assert.equal(analyzeHtml(html!).contentState, state, html);
});
test('deep mode makes a single GET, omits credentials and confirms actual HTML evidence', async () => {
  let calls = 0;
  globalThis.fetch = async (_, init) => { calls++; assert.equal(init!.method, 'GET'); assert.equal(init!.credentials, 'omit'); return response(); };
  const result = await checkDeepLink(link);
  assert.equal(calls, 1); assert.equal(result.mode, 'deep'); assert.equal(result.outcome, 'ok'); assert.equal(result.reason, 'content-found'); assert.ok(result.bytes! > 0);
});
test('200 error pages remain unverified; 404 remains broken', async () => {
  globalThis.fetch = async () => response('<h1>Page not found</h1>');
  assert.equal((await checkDeepLink(link)).reason, 'soft-error');
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal((await checkDeepLink(link)).outcome, 'broken');
});
test('bounds bytes and cancels excessive bodies, rejects non-HTML and partial responses', async () => {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(500)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } });
  assert.equal((await checkDeepLink(link, undefined, { maxBytes: 100 })).reason, 'size-limit'); assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response('PDF', { headers: { 'content-type': 'application/pdf' } });
  assert.equal((await checkDeepLink(link)).reason, 'unsupported-content');
  globalThis.fetch = async () => new Response(article, { status: 206, headers: { 'content-type': 'text/html' } });
  assert.equal((await checkDeepLink(link)).reason, 'incomplete');
});
test('honors charset and detects unsupported encoding and broken streams', async () => {
  globalThis.fetch = async () => new Response('<p>Actual page content which is long enough.</p>', { headers: { 'content-type': 'text/html; charset=invalid-encoding' } });
  assert.equal((await checkDeepLink(link)).reason, 'encoding');
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.error(new Error('truncated')); } }), { headers: { 'content-type': 'text/html' } });
  assert.equal((await checkDeepLink(link)).reason, 'incomplete');
});
test('retries temporary failure once, but honors Retry-After and total budget', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 503 }) : response();
  assert.equal((await checkDeepLink(link, undefined, { retryDelayMs: 1 })).outcome, 'ok'); assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '60' } }); };
  assert.equal((await checkDeepLink(link)).outcome, 'restricted'); assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const result = await checkDeepLink(link, undefined, { retryDelayMs: 1 }); assert.equal(result.attempts, 2); assert.equal(result.outcome, 'uncertain');
  assert.equal(retryDelay('2', 0, 1000), 2000); assert.equal(retryDelay('nonsense', 0, 1000), 1000);
});
test('aborts during body read and retry delay, with no extra attempt', async () => {
  const controller = new AbortController();
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } });
  const reading = checkDeepLink(link, controller.signal); setTimeout(() => controller.abort(), 5);
  await assert.rejects(reading); assert.equal(cancelled, true);
  const retry = new AbortController(); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  const pending = checkDeepLink(link, retry.signal); setTimeout(() => retry.abort(), 5);
  await assert.rejects(pending); assert.equal(calls, 1);
});
test('a stalled body is bounded by the total budget', async () => {
  globalThis.fetch = async () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/html' } });
  const hold = setInterval(() => {}, 50);
  try { const result = await checkDeepLink(link, undefined, { budgetMs: 20, attemptMs: 100 }); assert.equal(result.reason, 'timeout'); assert.equal(result.attempts, 1); }
  finally { clearInterval(hold); }
});
test('a 304 without content and invalid UTF-8 cannot produce a green deep result', async () => {
  globalThis.fetch = async () => new Response(null, { status: 304 });
  assert.equal((await checkDeepLink(link)).outcome, 'uncertain');
  globalThis.fetch = async () => new Response(new Uint8Array([0xff, 0xfe, 0xff]), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  assert.equal((await checkDeepLink(link)).reason, 'encoding');
});
