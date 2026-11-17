import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml } from '../lib/content.ts';
import { analyzeResource } from '../lib/resource-content.ts';
import { checkDeepLink } from '../lib/deep-checker.ts';
import { canCheckInBrowser } from '../lib/browser-candidates.ts';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const link = { url: 'https://example.com/resource', kind: 'external' as const, count: 1 };
const serve = (body: string, type: string, extra: Record<string,string> = {}) => { globalThis.fetch = async () => new Response(body, { headers: { 'content-type': type, ...extra } }); };
test('detects short error bodies without headings and does not reject articles discussing errors', () => {
  for (const html of ['<p>Page not found. Please check the address.</p>', '<div>503 Service Unavailable</div>', '<p>Sorry, this page could not be found.</p>', '<p>Сервис недоступен. Попробуйте позже.</p>']) {
    assert.equal(analyzeHtml(html).reason, 'soft-error', html);
  }
  assert.equal(analyzeHtml('<h1>HTTP guide</h1><p>Page not found is the description of HTTP 404.</p>').reason, 'content-found');
  assert.equal(analyzeHtml('<h1>How to diagnose service unavailable</h1><p>This article describes an error message.</p>').reason, 'content-found');
  assert.equal(analyzeHtml('<p>Checking your browser before accessing this website.</p>').reason, 'challenge');
});
test('recognizes passwordless login without treating ordinary contact forms as login', async () => {
  serve('<h1>Sign in to continue</h1><form><input type=email></form>', 'text/html');
  const result = await checkDeepLink(link);
  assert.equal(result.reason, 'login'); assert.equal(result.outcome, 'restricted'); assert.equal(canCheckInBrowser(result), true);
  assert.equal(analyzeHtml('<h1>Contact our support team</h1><form><input type=email></form><p>Send your questions about our service.</p>').contentState, 'present');
});
test('validates complete JSON and +json responses including valid scalar values', async () => {
  for (const body of ['{"items":[1,2]}','[]','{}','null','false','0','"hello"']) {
    serve(body, 'application/json'); const result = await checkDeepLink(link);
    assert.equal(result.outcome, 'ok', body); assert.equal(result.reason, 'resource-found'); assert.equal(canCheckInBrowser(result), false);
  }
  serve('{"name":"example"}', 'application/ld+json'); assert.equal((await checkDeepLink(link)).outcome, 'ok');
});
test('malformed JSON and RFC problem details do not become green or fabricate an HTTP status', async () => {
  serve('{"items":', 'application/json'); let result = await checkDeepLink(link);
  assert.equal(result.reason, 'invalid-resource'); assert.equal(result.status, 200); assert.equal(canCheckInBrowser(result), false);
  serve('{"type":"about:blank","title":"Not found","status":404}', 'application/problem+json'); result = await checkDeepLink(link);
  assert.equal(result.reason, 'soft-error'); assert.equal(result.status, 200); assert.equal(result.outcome, 'uncertain'); assert.equal(canCheckInBrowser(result), false);
  assert.equal(analyzeResource('[]', 'application/problem+json').reason, 'invalid-resource');
});
test('only narrow JSON error envelopes are suspicious, ordinary data with an error field is valid', () => {
  for (const body of ['{"error":"Not found"}','{"errors":["Invalid input"],"success":false}']) assert.equal(analyzeResource(body, 'application/json').reason, 'soft-error');
  for (const body of ['{"error":null,"status":200}', '{"article":"HTTP guide","error":"Example message"}', '[{"error":"Example"}]']) assert.equal(analyzeResource(body, 'application/json').reason, 'resource-found');
});
test('plain text supports short resources, rejects empty and binary-like bodies, never executes content', async () => {
  serve('OK', 'text/plain'); assert.equal((await checkDeepLink(link)).outcome, 'ok');
  serve('  \n', 'text/plain'); let result = await checkDeepLink(link); assert.equal(result.reason, 'empty-content'); assert.equal(canCheckInBrowser(result), false);
  serve('hello\u0000world', 'text/plain'); assert.equal((await checkDeepLink(link)).reason, 'invalid-resource');
  serve('<script>throw new Error("not executed")</script>', 'text/plain'); assert.equal((await checkDeepLink(link)).reason, 'resource-found');
});
test('checks declared uncompressed length and skips the comparison for decompressed bodies', async () => {
  const body = '{"name":"test"}';
  serve(body, 'application/json', { 'content-length': String(body.length + 10) });
  assert.equal((await checkDeepLink(link)).reason, 'incomplete');
  serve(body, 'application/json', { 'content-length': '2', 'content-encoding': 'gzip' });
  assert.equal((await checkDeepLink(link)).reason, 'resource-found');
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json', 'content-length': '5000' } });
  assert.equal((await checkDeepLink(link, undefined, { maxBytes: 100 })).reason, 'resource-limit'); assert.equal(cancelled, true);
});
test('attachments with HTML error pages are analyzed but never opened automatically', async () => {
  serve('<h1>Page not found</h1>', 'text/html', { 'content-disposition': 'attachment; filename="error.html"' });
  const result = await checkDeepLink(link); assert.equal(result.attachment, true); assert.equal(result.reason, 'soft-error'); assert.equal(canCheckInBrowser(result), false);
});
test('JSON uses UTF-8 and never interprets an HTML meta tag as its charset', async () => {
  serve('{"name":"Пример","snippet":"<meta charset=invalid>"}', 'application/json; charset=invalid');
  assert.equal((await checkDeepLink(link)).reason, 'resource-found');
  serve('<meta charset=invalid> some plain text', 'text/plain');
  assert.equal((await checkDeepLink(link)).reason, 'resource-found');
});
