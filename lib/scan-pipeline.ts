import { WorkPool } from './work-pool.ts';
import { canCheckInBrowser } from './browser-candidates.ts';
import type { Link, Result, ScanMode } from './types.ts';
export interface ScanPipeline {
  checkHttp(link: Link, mode: ScanMode, signal: AbortSignal): Promise<Result>;
  checkBrowser(row: Result, signal: AbortSignal): Promise<Result>;
  onResult(row: Result): Promise<void>;
  onBrowserProgress(completed: number, total: number): Promise<void>;
  httpPool?: WorkPool;
  browserPool?: WorkPool;
}
/** One explicit scan action; at most one automatic browser attempt per unique URL. */
export async function runScanPipeline(links: readonly Link[], mode: ScanMode, signal: AbortSignal, pipeline: ScanPipeline): Promise<void> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const http = pipeline.httpPool ?? new WorkPool(16, 4), browser = pipeline.browserPool ?? new WorkPool(2, 1);
  const renders: Promise<void>[] = [];
  let completed = 0, total = 0;
  let failure: unknown;
  const guard = async (task: () => Promise<void>) => {
    try { await task(); } catch (error) { if (!controller.signal.aborted) { failure = error; controller.abort(error); } }
  };
  await Promise.all(links.map(link => guard(async () => {
    const row = await http.run(link.url, combined, () => pipeline.checkHttp(link, mode, combined));
    combined.throwIfAborted();
    const render = mode === 'deep' && !row.browserAttempted && canCheckInBrowser(row);
    // Static positive HTML is provisional until visible content is checked.
    await pipeline.onResult(render && row.outcome === 'ok'
      ? { ...row, outcome: 'uncertain', reason: 'needs-browser', error: 'Needs browser check' } : row);
    if (!render) return;
    total++; await pipeline.onBrowserProgress(completed, total);
    combined.throwIfAborted();
    renders.push(guard(async () => {
      const checked = await browser.run(row.url, combined, () => pipeline.checkBrowser(row, combined));
      combined.throwIfAborted();
      await pipeline.onResult({ ...checked, browserAttempted: true });
      await pipeline.onBrowserProgress(++completed, total);
    }));
  })));
  await Promise.all(renders);
  signal.throwIfAborted();
  if (controller.signal.aborted) throw failure;
}
