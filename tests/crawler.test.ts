import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite, type CrawlPipeline } from '../lib/crawler.ts';
import { registrableDomain, siteScope, isActionUrl } from '../lib/site-scope.ts';
import { parseRobots, robotsGate } from '../lib/robots.ts';
import { collectLinks } from '../lib/urls.ts';
import { WorkPool } from '../lib/work-pool.ts';
import type { Result } from '../lib/types.ts';

test('site boundary uses public and private suffixes, wildcard exceptions, ports and exact IP origins', () => {
  assert.equal(registrableDomain('docs.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('one.github.io'), 'one.github.io');
  assert.equal(registrableDomain('a.b.ck'), 'a.b.ck');
  assert.equal(registrableDomain('x.www.ck'), 'www.ck');
  const inside = siteScope('https://docs.example.co.uk/');
  for (const url of ['https://example.co.uk/a','http://blog.example.co.uk/b']) assert.ok(inside(url));
  for (const url of ['https://example.co.uk.evil.com','https://other.co.uk','https://example.co.uk:8443/','javascript:alert(1)']) assert.equal(inside(url), false);
  assert.equal(siteScope('https://one.github.io')('https://two.github.io'), false);
  assert.equal(siteScope('http://127.0.0.1:8080')('http://127.0.0.1:8081'), false);
});

test('robots merges matching groups, longest match wins, allow wins ties; wildcard, end and encodings', () => {
  const allow = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nDisallow: /a%62\nUser-agent: *\nAllow: /same\nDisallow: /same\nUser-agent: Other\nDisallow: /');
  for (const path of ['/','/private/public/a','/doc.pdf?download=1','/same']) assert.ok(allow(`https://example.com${path}`), path);
  for (const path of ['/private/a','/doc.pdf','/ab','/a%62']) assert.equal(allow(`https://example.com${path}`), false, path);
  const named = parseRobots('User-agent: *\nDisallow: /\nUser-agent: LinkGuard\nAllow: /');
  assert.ok(named('https://example.com/a'));
  const unicode = parseRobots('User-agent: *\nDisallow: /привет');
  assert.equal(unicode('https://example.com/привет'), false);
  const stress = parseRobots(`User-agent: *\nDisallow: /${'*a'.repeat(100)}b$`);
  assert.ok(stress(`https://example.com/${'a'.repeat(500)}`));
});

test('robots cache shares an origin request; 404 allows, 503/429/network deny; cancellation exits', async () => {
  for (const status of [404,503,429]) {
    let requests = 0;
    const gate = robotsGate(async () => { requests++; return new Response(null, { status }); });
    const signal = new AbortController().signal;
    assert.deepEqual(await Promise.all([gate('https://example.com/a', signal), gate('https://example.com/b', signal)]), [status === 404, status === 404]);
    assert.equal(requests, 1);
  }
  const gate = robotsGate(async () => { throw new TypeError('Network'); });
  assert.equal(await gate('https://example.com', new AbortController().signal), false);
  const controller = new AbortController();
  const stalled = robotsGate(async () => new Response(new ReadableStream()));
  const pending = stalled('https://example.com', controller.signal); controller.abort();
  await assert.rejects(pending);
});

function fixture(graph: Record<string, string[]>) {
  const calls: string[] = [], results = new Map<string, Result>(), progress: object[] = [];
  const pipeline: CrawlPipeline = {
    async allowed() { return true; },
    async checkHttp(link) { calls.push(link.url); return { ...link, status: 200, mode: 'deep', outcome: 'ok', contentType: 'text/html', contentState: 'present', reason: 'content-found', method: 'GET', error: '', finalUrl: link.url, elapsed: 0 }; },
    async checkBrowser(row) { return { ...row, browserChecked: true, discoveredLinks: graph[row.url] ?? [] }; },
    async onResult(row) { results.set(row.url, row); }, async onBrowserProgress() {},
    async onCrawlProgress(state, truncated) { progress.push({ ...state, truncated }); },
  };
  return { pipeline, calls, results, progress };
}

test('BFS deduplicates cycles, expands subdomains, checks but never follows external pages, retains sources', async () => {
  const seed = 'https://example.com/';
  const f = fixture({
    'https://example.com/a': ['/b','https://blog.example.com/c',seed],
    'https://example.com/b': ['/a','https://outside.com/x'],
    'https://blog.example.com/c': ['https://example.com/b'],
    'https://outside.com/x': ['https://outside.com/never'],
  });
  await crawlSite(seed, collectLinks(['/a','https://outside.com/x'], seed).links, new AbortController().signal, f.pipeline);
  assert.equal(f.calls.length, 4); assert.equal(new Set(f.calls).size, 4);
  assert.ok(!f.calls.includes('https://outside.com/never'));
  assert.deepEqual(f.results.get('https://example.com/b')?.sources, ['https://example.com/a','https://blog.example.com/c']);
  assert.equal(f.results.get('https://blog.example.com/c')?.kind, 'internal');
  assert.equal(f.results.get('https://example.com/b')?.depth, 2);
});

test('crawl bounds query traps, depth, total URLs and skips action and robots-denied URLs without fetching', async () => {
  const seed = 'https://example.com/';
  for (const url of ['/logout','/sign-out','/?action=delete','/unsubscribe']) assert.ok(isActionUrl(seed.slice(0, -1) + url));
  assert.equal(isActionUrl(`${seed}guide/logout-explained`), true); // Deliberately conservative.
  const f = fixture({ 'https://example.com/a': ['/deeper'] });
  f.pipeline.allowed = async url => !url.endsWith('/blocked');
  const initial = collectLinks(['/a','/logout','/blocked',...Array.from({ length: 50 }, (_, i) => `/search?q=${i}`)], seed).links;
  await crawlSite(seed, initial, new AbortController().signal, f.pipeline, { maxUrls: 10, maxDepth: 1, maxQueryVariants: 2 });
  assert.equal(f.calls.length, 3); assert.ok(!f.calls.some(url => /logout|blocked|deeper/.test(url)));
  assert.equal(f.results.get(`${seed}logout`)?.reason, 'crawl-skipped');
  assert.equal((f.progress.at(-1) as any).truncated, true);
});

test('shared pool limits concurrent scans and cancels queued work without starting it', async () => {
  const pool = new WorkPool(3, 1), signal = new AbortController().signal;
  let active = 0, peak = 0; const origins = new Set<string>();
  const jobs = Array.from({ length: 20 }, (_, i) => {
    const url = `https://host${i % 4}.test/`;
    return pool.run(url, signal, async () => {
      assert.ok(!origins.has(url)); origins.add(url); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--; origins.delete(url);
    });
  });
  await Promise.all(jobs); assert.equal(peak, 3); assert.equal(active, 0);
  let release!: () => void;
  const held = pool.run('https://a.test/', signal, () => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve(); const cancelled = new AbortController();
  const queued = pool.run('https://a.test/b', cancelled.signal, async () => { assert.fail('queued cancellation started'); });
  cancelled.abort(); await assert.rejects(queued); release(); await held;
});
