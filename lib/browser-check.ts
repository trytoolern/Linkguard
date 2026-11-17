import { classifyContent } from './content.ts';
import { readRenderedPage, type RenderedPage } from './rendered-page.ts';
import { reasonMessages } from './reasons.ts';
import { classify } from './checker.ts';
import type { Result } from './types.ts';

// A small injectable boundary keeps lifecycle tests independent of Firefox.
export interface BrowserCheckApi {
  tabs: {
    create(options: { url: string; active: boolean; windowId?: number; cookieStoreId?: string }): Promise<{ id?: number }>;
    get(id: number): Promise<{ url?: string; status?: string; active?: boolean }>;
    remove(id: number): Promise<void>;
  };
  snapshot(id: number): Promise<RenderedPage | undefined>;
  response?(id: number): { url: string; status: number } | undefined;
  release?(id: number): void;
}
export { readRenderedPage };
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
async function wait(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await bounded(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}
export async function checkInBrowser(api: BrowserCheckApi, row: Result, signal: AbortSignal, windowId?: number, timing: { budgetMs: number; intervalMs: number; settleMs?: number } = { budgetMs: 18_000, intervalMs: 500, settleMs: 2000 }, cookieStoreId?: string): Promise<Result> {
  const started = Date.now();
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timing.budgetMs)]);
  let createdId: number | undefined;
  let previous = '', stable = 0;
  const cleanup = async (id: number) => {
    try { if (!(await api.tabs.get(id)).active) await api.tabs.remove(id); } catch { /* Already closed, or taken over by user. */ }
    finally { api.release?.(id); }
  };
  try {
    combined.throwIfAborted();
    const creating = api.tabs.create({ url: row.url, active: false, ...(windowId === undefined ? {} : { windowId }), ...(cookieStoreId ? { cookieStoreId } : {}) });
    // If creation resolves after cancellation, still clean up our own tab.
    void creating.then(tab => { if (combined.aborted && tab.id !== undefined) void cleanup(tab.id); }, () => {});
    const tab = await bounded(creating, combined);
    if (tab.id === undefined) throw new Error('Missing temporary tab');
    createdId = tab.id;
    while (true) {
      combined.throwIfAborted();
      const state = await bounded(api.tabs.get(createdId), combined);
      if (state.active) throw new Error('User activated temporary tab');
      if (!state.url || !/^https?:\/\//.test(state.url)) { await wait(timing.intervalMs, combined); continue; }
      // Reading early allows an SPA with a slow peripheral resource to be checked.
      let page: RenderedPage | undefined;
      try { page = await bounded(api.snapshot(createdId), combined); }
      catch { combined.throwIfAborted(); await wait(timing.intervalMs, combined); continue; }
      if (page && /^https?:\/\//.test(page.url)) {
        const evidence = classifyContent(page);
        // Ignore numeric counters, but not replacement text of the same length.
        const stableText = page.text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
        const signature = JSON.stringify([page.url, evidence.contentState, page.title, page.heading, stableText, page.loadedMedia, page.password, page.busy]);
        stable = signature === previous ? stable + 1 : 0; previous = signature;
        // Two matching observations after the first; don't accept a loading stub.
        const settled = ['present','challenge','login','suspected-error'].includes(evidence.contentState)
          || !page.script && !page.busy && page.readyState === 'complete' && ['empty','unverified'].includes(evidence.contentState);
        if (stable >= 2 && Date.now() - started >= (timing.settleMs ?? 0) && page.readyState !== 'loading' && !page.truncated && settled) {
          const response = api.response?.(createdId);
          const sameDocument = (url: string) => { const parsed = new URL(url); parsed.hash = ''; return parsed.href; };
          const status = response && sameDocument(response.url) === sameDocument(page.url) ? response.status : null;
          const http = status !== null && status >= 500 ? { outcome: 'uncertain' as const, error: 'Server error' }
            : status !== null && status >= 400 ? classify(status) : undefined;
          return { ...row, ...evidence, httpStatus: row.httpStatus ?? row.status, httpReason: row.httpReason ?? row.reason, browserAttempted: true, browserChecked: true, mode: 'deep', status, finalUrl: page.url,
            reason: status !== null && status >= 500 ? 'server-error' : http ? 'http' : evidence.reason,
            discoveredLinks: evidence.contentState === 'present' ? page.links : undefined, discoveryTruncated: page.linksTruncated,
            outcome: http?.outcome ?? (evidence.contentState === 'present' ? (row.status !== null && row.status >= 400 && status === null ? 'uncertain' : 'ok') : ['challenge','login'].includes(evidence.contentState) ? 'restricted' : 'uncertain'),
            error: http?.error ?? (evidence.contentState === 'present' ? (row.status !== null && row.status >= 400 && status === null ? 'Could not verify' : '') : reasonMessages[evidence.reason]), elapsed: Date.now() - started };
        }
      }
      await wait(timing.intervalMs, combined);
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    return { ...row, httpStatus: row.httpStatus ?? row.status, httpReason: row.httpReason ?? row.reason, browserAttempted: true,
      outcome: row.outcome === 'ok' ? 'uncertain' : row.outcome, contentState: row.outcome === 'ok' ? 'unverified' : row.contentState,
      reason: combined.aborted ? 'timeout' : 'needs-browser', error: combined.aborted ? 'Timeout' : 'Needs browser check', elapsed: Date.now() - started };
  } finally { if (createdId !== undefined) await cleanup(createdId); }
}
