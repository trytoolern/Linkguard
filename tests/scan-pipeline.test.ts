import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScanPipeline } from '../lib/scan-pipeline.ts';
import { canCheckInBrowser } from '../lib/browser-candidates.ts';
import type { Result, Link } from '../lib/types.ts';
const make = (url: string): Link => ({ url, kind: 'external', count: 1 });
const row = (link: Link, reason: Result['reason'] = 'needs-browser'): Result => ({ ...link, mode: 'deep', method: 'GET', finalUrl: link.url, status: 200, elapsed: 1, outcome: 'uncertain', error: 'Needs browser check', contentState: 'needs-browser', reason, contentType: 'text/html' });
test('deep mode renders successful and ambiguous HTML once, but not downloads', async () => {
  const links = ['app','image','good','pdf'].map(name => make(`https://${name}.test/`));
  const updates: Result[] = [], opened: string[] = [], progress: number[] = [];
  await runScanPipeline(links, 'deep', new AbortController().signal, {
    async checkHttp(link) { return link.url.includes('good') ? { ...row(link), outcome: 'ok', reason: 'content-found' } : link.url.includes('pdf') ? { ...row(link), contentType: 'application/pdf', reason: 'unsupported-content' } : row(link, link.url.includes('image') ? 'media-unverified' : 'needs-browser'); },
    async checkBrowser(result) { opened.push(result.url); return result; }, // Even unresolved results must not loop.
    async onResult(result) { updates.push(result); },
    async onBrowserProgress(done) { progress.push(done); },
  });
  assert.deepEqual(opened.sort(), [links[0]!.url, links[1]!.url, links[2]!.url].sort());
  assert.equal(updates.filter(result => result.browserAttempted).length, 3);
  assert.equal(progress.at(-1), 3);
  assert.equal(updates.find(result => result.url === links[2]!.url)?.outcome, 'uncertain');
});
test('browser queue has two slots globally and one per origin', async () => {
  const links = Array.from({ length: 9 }, (_, i) => make(`https://site${i % 3}.test/${i}`));
  let active = 0, peak = 0;
  const hosts = new Map<string, number>();
  await runScanPipeline(links, 'deep', new AbortController().signal, {
    async checkHttp(link) { return row(link); },
    async checkBrowser(result) {
      const host = new URL(result.url).origin;
      active++; peak = Math.max(peak, active); hosts.set(host, (hosts.get(host) ?? 0) + 1);
      assert.ok(active <= 2); assert.equal(hosts.get(host), 1);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--; hosts.set(host, hosts.get(host)! - 1); return { ...result, browserChecked: true, outcome: 'ok' };
    }, async onResult() {}, async onBrowserProgress() {},
  });
  assert.equal(peak, 2); assert.equal(active, 0);
});
test('quick scans never open browser tabs; cancellation skips queued browser work', async () => {
  const links = [make('https://a.test'),make('https://b.test'),make('https://c.test')];
  let opens = 0;
  const controller = new AbortController();
  const pipeline = { async checkHttp(link: Link) { return row(link); }, async checkBrowser(result: Result) { opens++; controller.abort(); return result; }, async onResult() {}, async onBrowserProgress() {} };
  await runScanPipeline(links, 'quick', new AbortController().signal, pipeline); assert.equal(opens, 0);
  await assert.rejects(runScanPipeline(links, 'deep', controller.signal, pipeline)); assert.equal(opens, 1);
});
test('only HTML authentication failures escalate; 429/5xx/downloads stay outside browser fallback', () => {
  const base = row(make('https://example.com'));
  for (const status of [401,403,404,410]) {
    assert.equal(canCheckInBrowser({ ...base, status, reason: 'http', contentType: 'text/html' }), true);
    assert.equal(canCheckInBrowser({ ...base, status, reason: 'http', contentType: 'application/pdf' }), false);
  }
  for (const status of [429,500,503]) assert.equal(canCheckInBrowser({ ...base, status }), false);
  assert.equal(canCheckInBrowser({ ...base, browserChecked: true }), false);
});

test('starts rendering a fast result while another HTTP request is still pending', async () => {
  let release!: () => void, rendered = false;
  const slow = new Promise<void>(resolve => { release = resolve; });
  await runScanPipeline([make('https://slow.test/'), make('https://fast.test/')], 'deep', new AbortController().signal, {
    async checkHttp(link) { if (link.url.includes('slow')) await slow; return row(link); },
    async checkBrowser(result) { if (result.url.includes('fast')) { rendered = true; release(); } return result; },
    async onResult() {}, async onBrowserProgress() {},
  });
  assert.ok(rendered);
});

test('a failing callback aborts and joins all concurrent work', async () => {
  let active = 0;
  await assert.rejects(runScanPipeline([make('https://a.test/'), make('https://b.test/')], 'deep', new AbortController().signal, {
    async checkHttp(link, _mode, signal) {
      if (link.url.includes('b.test')) {
        active++; try { await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } finally { active--; }
      }
      return row(link);
    }, async checkBrowser(result) { return result; },
    async onResult() { throw new Error('Storage failure'); }, async onBrowserProgress() {},
  }), /Storage failure/);
  assert.equal(active, 0);
});
