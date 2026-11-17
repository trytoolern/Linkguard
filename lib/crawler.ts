import { collectLinks, normalizeUrl } from './urls.ts';
import { isActionUrl, siteScope } from './site-scope.ts';
import { runScanPipeline, type ScanPipeline } from './scan-pipeline.ts';
import type { Link, Result } from './types.ts';
export const CRAWL_DEFAULTS = { maxUrls: 1000, maxDepth: 5, maxQueryVariants: 20, maxSources: 20 };
export interface CrawlProgress { discovered: number; expanded: number; depth: number; limit: number }
export interface CrawlPipeline extends ScanPipeline {
  allowed(url: string, signal: AbortSignal): Promise<boolean>;
  onCrawlProgress(progress: CrawlProgress, truncated: boolean): Promise<void>;
}
/** Bounded breadth-first crawl. External destinations are checked, never expanded. */
export async function crawlSite(seed: string, initial: readonly Link[], signal: AbortSignal, pipeline: CrawlPipeline, settings: Partial<typeof CRAWL_DEFAULTS> = {}) {
  const options = { ...CRAWL_DEFAULTS, ...settings }, internal = siteScope(seed);
  if (!Object.values(options).every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid crawl limits');
  const entries = new Map<string, Link & { sources: string[]; depth: number }>();
  const results = new Map<string, Result>(), expanded = new Set<string>();
  const variants = new Map<string, number>(), seedUrl = normalizeUrl(seed, seed)!;
  let truncated = false; expanded.add(seedUrl);
  function discover(links: readonly Link[], source: string, depth: number) {
    for (const link of links) {
      const url = normalizeUrl(link.url, source); if (!url || url === seedUrl) continue;
      const prior = entries.get(url);
      if (prior) {
        if (!prior.sources.includes(source)) {
          if (prior.sources.length < options.maxSources) prior.sources.push(source); else truncated = true;
          prior.count += link.count;
        }
        continue;
      }
      const parsed = new URL(url), family = parsed.origin + parsed.pathname;
      if (depth > options.maxDepth || entries.size >= options.maxUrls || (parsed.search || parsed.hash) && (variants.get(family) ?? 0) >= options.maxQueryVariants) { truncated = true; continue; }
      if (parsed.search || parsed.hash) variants.set(family, (variants.get(family) ?? 0) + 1);
      entries.set(url, { ...link, url, kind: internal(url) ? 'internal' : 'external', sources: [source], depth });
    }
  }
  discover(initial, seed, 1);
  let done = 0, total = 0;
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    signal.throwIfAborted();
    const batch = [...entries.values()].filter(entry => entry.depth === depth);
    if (!batch.length) break;
    const baseDone = done, baseTotal = total;
    await pipeline.onCrawlProgress({ discovered: entries.size, expanded: expanded.size, depth, limit: options.maxUrls }, truncated);
    await runScanPipeline(batch, 'deep', signal, {
      ...pipeline,
      async checkHttp(link, mode, taskSignal) {
        const action = isActionUrl(link.url);
        if (action || !await pipeline.allowed(link.url, taskSignal)) return { ...link, mode, method: 'GET', finalUrl: link.url, status: null, outcome: 'uncertain', error: action ? 'Action link skipped' : 'Blocked by crawl rules', reason: 'crawl-skipped', contentState: 'not-checked', elapsed: 0 };
        return pipeline.checkHttp(link, mode, taskSignal);
      },
      async onBrowserProgress(completed, count) { done = baseDone + completed; total = baseTotal + count; await pipeline.onBrowserProgress(done, total); },
      async onResult(row) {
        const entry = entries.get(row.url)!;
        const enriched = { ...row, sources: [...entry.sources], depth: entry.depth, count: entry.count };
        results.set(row.url, enriched); await pipeline.onResult(enriched);
      },
    });
    for (const entry of batch) {
      const row = results.get(entry.url);
      if (!row?.browserChecked || row.outcome !== 'ok' || !internal(entry.url) || !internal(row.finalUrl)) continue;
      const final = normalizeUrl(row.finalUrl, seed)!; if (expanded.has(final)) continue;
      expanded.add(final); if (row.discoveryTruncated) truncated = true;
      const found = collectLinks(row.discoveredLinks ?? [], row.finalUrl, options.maxUrls);
      truncated ||= found.truncated; discover(found.links, row.finalUrl, depth + 1);
    }
  }
  for (const [url, row] of results) {
    const entry = entries.get(url)!; await pipeline.onResult({ ...row, count: entry.count, sources: [...entry.sources] });
  }
  await pipeline.onCrawlProgress({ discovered: entries.size, expanded: expanded.size, depth: Math.max(0, ...[...entries.values()].map(e => e.depth)), limit: options.maxUrls }, truncated);
}
