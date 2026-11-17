import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { collectLinks } from '../lib/urls';
import { checkLink } from '../lib/checker';
import { checkDeepLink } from '../lib/deep-checker';
import { runScanPipeline, type ScanPipeline } from '../lib/scan-pipeline';
import { WorkPool } from '../lib/work-pool';
import { crawlSite } from '../lib/crawler';
import { robotsGate } from '../lib/robots';
import { isActionUrl } from '../lib/site-scope';
import { canCheckInBrowser } from '../lib/browser-candidates';
import { checkInBrowser, readRenderedPage } from '../lib/browser-check';
import { readPage, markPage } from '../lib/page';
import type { Message, Reply, Scan } from '../lib/types';

export default defineBackground(() => {
  const jobs = new Map<number, { state: Scan; controller: AbortController }>();
  const starting = new Set<number>();
  const closed = new Set<number>();
  // Shared across scans in different source tabs, not multiplied per scan.
  const httpPool = new WorkPool(16, 4), browserPool = new WorkPool(2, 1);
  const ownedTabs = new Set<number>();
  const navigationResponses = new Map<number, { url: string; status: number }>();
  browser.webRequest?.onHeadersReceived.addListener(details => {
    if (ownedTabs.has(details.tabId)) navigationResponses.set(details.tabId, { url: details.url, status: details.statusCode });
    return undefined;
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
  const key = (id: number) => `scan:${id}`;
  // Serialize storage writes so an old progress update cannot overwrite completion.
  let writes = Promise.resolve();
  function save(state: Scan) {
    if (closed.has(state.tabId)) return writes;
    const snapshot = structuredClone(state);
    writes = writes.catch(() => {}).then(() => browser.storage.session.set({ [key(state.tabId)]: snapshot }));
    return writes;
  }
  async function get(tabId: number): Promise<Scan | undefined> {
    if (jobs.has(tabId)) return jobs.get(tabId)!.state;
    const state = (await browser.storage.session.get(key(tabId)))[key(tabId)] as Scan | undefined;
    if (state?.renderingUrl) { delete state.renderingUrl; state.message = 'Needs browser check'; await save(state); }
    if (state?.phase === 'scanning') {
      delete state.browserProgress;
      state.phase = 'interrupted'; state.message = 'Scan interrupted. Scan again to finish checking this page.';
      await save(state);
    }
    return state;
  }
  async function highlight(state: Scan, enabled: boolean) {
    const response = await browser.scripting.executeScript({ target: { tabId: state.tabId }, func: markPage, args: [enabled ? state.results.filter(r => r.outcome === 'broken').map(r => r.url) : [], state.pageUrl] });
    if (!response[0]?.result) throw new Error('Page changed. Scan the current page again.');
    state.highlighted = enabled;
  }
  const browserApi = {
    tabs: {
      async create(options: { url: string; active: boolean; windowId?: number; cookieStoreId?: string }) {
        // Register ownership before navigation so even a cached response is observed.
        const tab = await browser.tabs.create({ ...options, url: 'about:blank' });
        if (tab.id !== undefined) {
          ownedTabs.add(tab.id);
          void browser.tabs.update(tab.id, { url: options.url }).catch(() => {});
        }
        return tab;
      },
      get: (id: number) => browser.tabs.get(id),
      async remove(id: number) { ownedTabs.delete(id); navigationResponses.delete(id); await browser.tabs.remove(id); },
    },
    response: (id: number) => navigationResponses.get(id),
    release(id: number) { ownedTabs.delete(id); navigationResponses.delete(id); },
    async snapshot(id: number) {
      const [injection] = await browser.scripting.executeScript({ target: { tabId: id }, func: readRenderedPage });
      return injection?.result;
    },
  };
  async function run(state: Scan, links: ReturnType<typeof collectLinks>['links'], controller: AbortController, windowId?: number) {
    let lastSave = 0;
    try {
      const pipeline: ScanPipeline = {
        httpPool, browserPool,
        async checkHttp(link, mode, signal) {
          if (isActionUrl(link.url)) return { ...link, mode, method: mode === 'deep' ? 'GET' : 'HEAD', finalUrl: link.url, status: null, outcome: 'uncertain', error: 'Action link skipped', reason: 'crawl-skipped', contentState: 'not-checked', elapsed: 0 };
          return mode === 'deep' ? checkDeepLink(link, signal)
            : { ...await checkLink(link, signal), mode: 'quick', contentState: 'not-checked', reason: 'http' };
        },
        async checkBrowser(row, signal) {
          const source = await browser.tabs.get(state.tabId);
          if (source.url !== state.pageUrl) { controller.abort(); signal.throwIfAborted(); }
          if (!await browser.permissions.contains({ origins: ['http://*/*', 'https://*/*'] })) throw new Error('Allow access to websites using Scan current page before checking links.');
          const cookies = browser.runtime.getManifest().optional_permissions?.includes('cookies')
            && await browser.permissions.contains({ permissions: ['cookies'] });
          return checkInBrowser(browserApi, row, signal, windowId, undefined, cookies ? (source as { cookieStoreId?: string }).cookieStoreId : undefined);
        },
        async onResult(result) {
          // Discovery is consumed by the crawler, not copied into session storage.
          const { discoveredLinks: _links, discoveryTruncated: _truncated, ...stored } = result;
          const index = state.results.findIndex(row => row.url === result.url);
          if (index < 0) state.results.push(stored); else state.results[index] = stored;
          if (Date.now() - lastSave > 200) { lastSave = Date.now(); await save(state); }
        },
        async onBrowserProgress(completed, total) {
          state.browserProgress = { completed, total }; await save(state);
        },
      };
      if (state.scope === 'site') await crawlSite(state.pageUrl, links, controller.signal, {
        ...pipeline, allowed: robotsGate(),
        async onCrawlProgress(progress, truncated) { state.crawl = progress; state.total = progress.discovered; state.truncated ||= truncated; await save(state); },
      });
      else await runScanPipeline(links, state.mode ?? 'quick', controller.signal, pipeline);
      if (!controller.signal.aborted) {
        state.phase = 'done';
        try { await highlight(state, true); } catch { state.message = 'Results saved. Page changed or highlighting is unavailable.'; }
      }
    } catch (error) {
      if (!controller.signal.aborted) { state.phase = 'error'; state.message = error instanceof Error ? error.message : 'Scan failed'; }
    } finally {
      delete state.browserProgress;
      if (controller.signal.aborted) state.phase = 'cancelled';
      await save(state);
      if (jobs.get(state.tabId)?.state.id === state.id) jobs.delete(state.tabId);
    }
  }
  async function render(state: Scan, url: string, controller: AbortController, windowId?: number) {
    try {
      if (controller.signal.aborted || (await browser.tabs.get(state.tabId)).url !== state.pageUrl) return;
      const index = state.results.findIndex(row => row.url === url);
      const row = state.results[index]; if (!row) return;
      const source = await browser.tabs.get(state.tabId);
      const cookies = browser.runtime.getManifest().optional_permissions?.includes('cookies')
            && await browser.permissions.contains({ permissions: ['cookies'] });
      const result = await browserPool.run(row.url, controller.signal, () => checkInBrowser(browserApi, row, controller.signal, windowId, undefined, cookies ? (source as { cookieStoreId?: string }).cookieStoreId : undefined));
      delete result.discoveredLinks; delete result.discoveryTruncated;
      if (!controller.signal.aborted && (await browser.tabs.get(state.tabId)).url === state.pageUrl) state.results[index] = result;
    } catch { /* Cancellation and navigation leave the original evidence intact. */ }
    finally {
      delete state.renderingUrl;
      try { await save(state); }
      finally { if (jobs.get(state.tabId)?.controller === controller) jobs.delete(state.tabId); }
    }
  }
  async function handle(message: Message): Promise<Reply> {
    const { tabId } = message;
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('No active tab.');
    if (message.type === 'get') return { scan: await get(tabId) };
    if (message.type === 'cancel') {
      const job = jobs.get(tabId);
      if (job) { job.controller.abort(); if (!job.state.renderingUrl) job.state.phase = 'cancelled'; await save(job.state); }
      return { scan: await get(tabId) };
    }
    if (message.type === 'render') {
      if (jobs.has(tabId) || starting.has(tabId)) throw new Error('A scan is already running.');
      starting.add(tabId);
      try {
        if (!await browser.permissions.contains({ origins: ['http://*/*', 'https://*/*'] })) throw new Error('Allow access to websites using Scan current page before checking links.');
        const state = await get(tabId);
        const row = state?.results.find(result => result.url === message.url && canCheckInBrowser(result));
        if (!state || !row) throw new Error('Scan this page first.');
        const tab = await browser.tabs.get(tabId);
        if (tab.url !== state.pageUrl) throw new Error('Page changed. Scan the current page again.');
        const controller = new AbortController();
        state.renderingUrl = row.url; state.message = '';
        jobs.set(tabId, { state, controller });
        try { await save(state); }
        catch (error) { jobs.delete(tabId); delete state.renderingUrl; throw error; }
        void render(state, row.url, controller, tab.windowId).catch(() => {});
        return { scan: state };
      } finally { starting.delete(tabId); }
    }
    if (message.type === 'highlight') {
      const state = await get(tabId); if (!state) throw new Error('Scan this page first.');
      await highlight(state, !!message.enabled); await save(state); return { scan: state };
    }
    if (message.mode !== undefined && message.mode !== 'quick' && message.mode !== 'deep') throw new Error('Unknown request.');
    if (message.scope !== undefined && message.scope !== 'page' && message.scope !== 'site') throw new Error('Unknown request.');
    if (message.type !== 'scan') throw new Error('Unknown request.');
    if (jobs.has(tabId) || starting.has(tabId)) throw new Error('A scan is already running.');
    starting.add(tabId);
    closed.delete(tabId);
    try {
      const allowed = await browser.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
      if (!allowed) throw new Error('Allow access to websites using Scan current page before checking links.');
      const tab = await browser.tabs.get(tabId);
      if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a regular HTTP or HTTPS page first.');
      const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: readPage });
      const page = injection?.result;
      if (!page) throw new Error('Cannot read this page. Browser-protected pages cannot be scanned.');
      const { links, skipped, truncated } = collectLinks(page.hrefs, page.pageUrl);
      const state: Scan = { scope: message.scope ?? 'page', mode: message.scope === 'site' ? 'deep' : message.mode ?? 'quick', id: crypto.randomUUID(), tabId, pageUrl: page.pageUrl, phase: 'scanning', total: links.length, skipped, truncated: truncated || page.overflow, results: [], started: Date.now(), message: '', highlighted: false };
      const controller = new AbortController();
      await highlight(state, false);
      jobs.set(tabId, { state, controller });
      try { await save(state); } catch { jobs.delete(tabId); throw new Error('Session storage is full or unavailable. Close old scanned tabs and retry.'); }
      void run(state, links, controller, tab.windowId).catch(() => { jobs.delete(tabId); });
      return { scan: state };
    } finally { starting.delete(tabId); }
  }
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only extension pages may request scans; a webpage never supplies a fetch URL.
    if (sender.id !== browser.runtime.id || sender.tab || !sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
    void handle(message as Message).catch(error => ({ error: error instanceof Error ? error.message : 'Something went wrong.' })).then(sendResponse);
    return true;
  });
  browser.tabs.onRemoved.addListener(tabId => {
    closed.add(tabId);
    jobs.get(tabId)?.controller.abort();
    writes = writes.catch(() => {}).then(() => browser.storage.session.remove(key(tabId)));
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) jobs.get(tabId)?.controller.abort();
  });
});
