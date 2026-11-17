<script lang="ts">
  import { languageGroups, languages, detectLocale, resolveLocale, isLocale, getDirection, translate, type Locale } from '../../lib/i18n';
  import project from '../../project.json';
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { canCheckInBrowser } from '../../lib/browser-candidates';
  import { filtered, searchResults, toCsv, toText } from '../../lib/export';
  import type { Filter, Message, Reply, Scan, ScanMode } from '../../lib/types';
  let locale = $state<Locale>(detectLocale(navigator.languages));
  let selectedMode = $state<ScanMode | 'site'>('quick');
  const scope = $derived(selectedMode === 'site' ? 'site' : 'page');
  let kind = $state<'all' | 'internal' | 'external'>('all');
  let languageReady = $state(false), noticeCount = $state(0);
  const t = (text: string, params: Record<string, string | number> = {}) => translate(locale, text, params);
  $effect(() => { document.documentElement.lang = locale; document.documentElement.dir = getDirection(locale); });
  async function changeLanguage(value: string) {
    if (!isLocale(value)) return;
    locale = value;
    try { await browser.storage.local.set({ locale: value }); }
    catch { error = 'Could not save language. It will apply only until this popup closes.'; }
  }
  let scan = $state<Scan>();
  let tabId = $state(-1), pageUrl = $state(''), error = $state(''), notice = $state('');
  let busy = $state(false), ready = $state(false), filter = $state<Filter>('All');
  let visibleCount = $state(100);
  let query = $state('');
  const containers = browser.runtime.getManifest().optional_permissions?.includes('cookies') ?? false;
  const filters: Filter[] = ['All', 'Broken', 'Unverified'];
  const running = $derived(scan?.phase === 'scanning' || !!scan?.renderingUrl || !!scan?.browserProgress);
  const searched = $derived(searchResults(scan?.results ?? [], query, row => `${t(row.error)} ${t(row.kind === 'internal' ? 'Internal' : 'External')}`));
  const typed = $derived(searched.filter(row => kind === 'all' || row.kind === kind));
  const rows = $derived(filtered(typed, filter));
  const broken = $derived(scan?.results.filter(r => r.outcome === 'broken').length ?? 0);
  const checked = $derived(scan?.results.length ?? 0);
  const stale = $derived(!!scan && pageUrl !== scan.pageUrl);
  const hostname = $derived.by(() => { try { return new URL(pageUrl).hostname; } catch { return t('Current page'); } });
  const supported = $derived(/^https?:\/\//.test(pageUrl));
  async function send(type: Message['type'], enabled?: boolean, mode?: ScanMode, url?: string) {
    error = ''; busy = true;
    try {
      const reply = await browser.runtime.sendMessage({ type, tabId, enabled, mode, url, ...(type === 'scan' ? { scope } : {}) }) as Reply;
      if (reply.error) error = reply.error;
      else scan = reply.scan;
    } catch { error = 'Could not reach LinkGuard. Reopen the popup and try again.'; }
    finally { busy = false; }
  }
  async function start(mode: ScanMode) {
    filter = 'All'; kind = 'all'; query = ''; visibleCount = 100; notice = ''; error = ''; busy = true;
    try {
      // Request in the click handler: Firefox requires a direct user gesture.
      const allowed = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'], ...(mode === 'deep' && containers ? { permissions: ['cookies'] } : {}) });
      if (!allowed) { error = 'Website access was not granted. Click Scan current page to try again.'; return; }
      await send('scan', undefined, mode);
    } catch { error = 'Could not request website access. Check LinkGuard permissions in Firefox.'; }
    finally { busy = false; }
  }
  async function copy() {
    try { const count = rows.length; await navigator.clipboard.writeText(toText(rows, locale)); noticeCount = count; notice = 'Copied results: {count}'; }
    catch { error = 'Clipboard unavailable. Use Export CSV instead.'; }
  }
  async function renderLink(url: string) {
    try {
      const allowed = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'], ...(containers ? { permissions: ['cookies'] } : {}) });
      if (!allowed) { error = 'Website access was not granted. Click Scan current page to try again.'; return; }
      await send('render', undefined, undefined, url);
    } catch { error = 'Could not request website access. Check LinkGuard permissions in Firefox.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([toCsv(rows, locale)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `linkguard-${hostname}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); noticeCount = rows.length; notice = 'Exported results: {count}';
  }
  onMount(() => {
    let disposed = false;
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && changes.locale) locale = resolveLocale(changes.locale.newValue, navigator.languages);
      if (area === 'session' && changes[`scan:${tabId}`]) scan = changes[`scan:${tabId}`]!.newValue as Scan | undefined;
    };
    browser.storage.onChanged.addListener(listener);
    void (async () => {
      try {
        const stored = await browser.storage.local.get('locale');
        if (disposed) return;
        locale = resolveLocale(stored.locale, [browser.i18n.getUILanguage(), ...navigator.languages]);
      } catch { /* Browser language remains usable if local storage is unavailable. */ }
      finally { languageReady = true; }
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (disposed) return;
        tabId = tab?.id ?? -1; pageUrl = tab?.url ?? '';
        await send('get');
        if (scan) selectedMode = scan.scope === 'site' ? 'site' : scan.mode ?? 'quick';
      } catch { error = 'Could not read the active tab.'; }
      finally { ready = true; }
    })();
    return () => { disposed = true; browser.storage.onChanged.removeListener(listener); };
  });
</script>

<main class="popup">
  <header class="app-header flex items-center gap-2">
    <img src="/icon/32.png" alt="" width="18" height="18" />
    <h1 dir="ltr">LinkGuard</h1>
    <select class="language-select" aria-label={t('Language')} title={t('Language')} value={locale} disabled={!languageReady}
      onchange={e => changeLanguage(e.currentTarget.value)}>
      {#each languageGroups as group}
        <optgroup label={t(group)}>
          {#each languages.filter(language => language.group === group) as language}<option value={language.code} lang={language.code} dir={getDirection(language.code)}>{language.name}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </header>

  <section class="scan-panel" aria-label={t('Current page')}>
    <div class="page-info">
      <span class="field-label">{t('Current page')}</span>
      <div class="hostname" dir="ltr" title={pageUrl}>{hostname}</div>
    </div>
    <div class="scan-controls">
      <select class="mode-select" aria-label={t('Scan mode')} value={selectedMode} disabled={running || busy || !ready}
        onchange={e => selectedMode = e.currentTarget.value as ScanMode | 'site'}>
        <option value="quick">{t('Quick scan')}</option>
        <option value="deep">{t('Deep scan')}</option>
        <option value="site">{t('Site and subdomains')}</option>
      </select>
      {#if running}
        <button class="scan-button stop-scan" disabled={busy} onclick={() => send('cancel')}>{t('Stop scan')}</button>
      {:else}
        <button class="scan-button start-scan" disabled={!ready || busy || !supported}
          onclick={() => start(selectedMode === 'quick' ? 'quick' : 'deep')}>{t('Scan')}</button>
      {/if}
    </div>
    {#if selectedMode !== 'quick'}<p class="hint scan-hint">{t('Opens a temporary tab using your browser session.')}</p>{/if}
  </section>

  {#if !ready || scan}
  <div class="scan-status" role="status">
    {#if !ready}{t('Loading…')}
    {:else if scan?.browserProgress}{t('Checking in browser…')} <span dir="ltr">{scan.browserProgress.completed}/{scan.browserProgress.total}</span>
    {:else if scan?.renderingUrl}{t('Checking in browser…')}
    {:else if running}{t('Checking {checked} of {total} links…', { checked, total: scan?.total ?? 0 })}
    {:else if scan}
      <span>{t(scan.scope === 'site' ? 'Site and subdomains' : scan.mode === 'deep' ? 'Deep scan' : 'Quick scan')}</span>
      <span>{t('Checked: {count}', { count: checked })}</span>
    {:else}{t('Not scanned')}{/if}
  </div>
  {/if}
  {#if scan?.phase === 'scanning' && !scan.browserProgress}<progress value={checked} max={scan?.total || 1} aria-label={t('Links checked')}></progress>{/if}
  {#if ready && !supported}<p class="message">{t('Open an HTTP or HTTPS website. Browser pages cannot be scanned.')}</p>{/if}
  {#if error}<p role="alert" class="message error">{t(error)}</p>{/if}
  {#if stale}<p class="message">{t('These results are from a previous page. Scan again.')}</p>{/if}
  {#if scan?.message}<p class="message">{t(scan.message)}</p>{/if}
  {#if scan?.phase === 'cancelled' || scan?.phase === 'interrupted'}<p class="message">{t(scan.phase === 'cancelled' ? 'Scan cancelled. Showing {checked} of {total} links.' : 'Scan interrupted. Showing {checked} of {total} links.', { checked, total: scan.total })}</p>{/if}

  {#if scan}
  <nav class="filters flex" aria-label={t('Filter links')}>
    {#each filters as item}
      <button class="filter flex-1" class:selected={filter === item} aria-pressed={filter === item}
        onclick={() => { filter = item; visibleCount = 100; notice = ''; }}>
        {t(item)}{#if scan}<span class="filter-count">{filtered(typed, item).length}</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="result-search">
    <input type="search" maxlength="256" aria-controls="link-results" aria-label={t('Search results')} placeholder={t('Search results')} value={query}
      oninput={e => { query = e.currentTarget.value; visibleCount = 100; notice = ''; }}
      onkeydown={e => { if (e.key === 'Escape') { query = ''; visibleCount = 100; } }} />
    <select class="kind-select" aria-label={t('Type')} value={kind}
      onchange={e => { kind = e.currentTarget.value as typeof kind; visibleCount = 100; notice = ''; }}>
      <option value="all">{t('Type')}: {t('All')}</option>
      <option value="internal">{t('Internal')}</option>
      <option value="external">{t('External')}</option>
    </select>
  </div>
  {/if}

  <section id="link-results" class="results" class:initial={!scan} aria-label={t('Link results')}>
    {#if scan}<table>
      <caption class="sr-only">{t('Page links with HTTP status, type and error details')}</caption>
      <thead><tr><th scope="col">{t('URL / error')}</th><th scope="col">HTTP</th><th scope="col">{t('Type')}</th></tr></thead>
      <tbody>{#each rows.slice(0, visibleCount) as row (row.url)}
        <tr class:broken={row.outcome === 'broken'}>
          <td>
            <a dir="ltr" href={row.url} target="_blank" rel="noreferrer" title={row.url}>{row.url.replace(/^https?:\/\//, '')}</a>
            {#if row.error}<span class="row-detail" class:bad={row.outcome === 'broken'}>{t(row.error)}</span>
            {:else if row.finalUrl !== row.url}<span class="row-detail" title={row.finalUrl}>{t('Redirected')}</span>{/if}
            {#if row.browserChecked}<span class="row-detail">{t('Checked in browser')}</span>{/if}
            {#if row.sources?.length}
              <details class="row-sources"><summary>{t('Source pages')}: {row.sources.length}</summary>
                {#each row.sources as source}<a dir="ltr" href={source} target="_blank" rel="noreferrer" title={source}>{source}</a>{/each}
              </details>
            {/if}
            {#if canCheckInBrowser(row)}
              <button class="browser-check" disabled={busy || running || stale} title={t('Opens a temporary tab using your browser session.')}
                onclick={() => renderLink(row.url)}>{t('Check in browser')}</button>
            {/if}
            {#if row.count > 1}<span class="row-detail">{t('Occurrences: {count}', { count: row.count })}</span>{/if}
          </td>
          <td><span dir="ltr" class="http-status" class:bad={row.outcome === 'broken'} title={`${row.method} · ${row.elapsed} ms`}>{row.status ?? '—'}</span>
            {#if row.browserChecked && row.httpStatus !== undefined && row.httpStatus !== null}<span class="row-detail" title={t('Initial HTTP status')}>GET {row.httpStatus}</span>{/if}
          </td>
          <td class="kind">
            <span>{t(row.kind === 'internal' ? 'Internal' : 'External')}</span>
            <span class="link-outcome" class:working={row.outcome === 'ok'} class:bad={row.outcome === 'broken'}
              data-outcome={row.outcome}>{t(row.outcome === 'ok' ? (row.mode === 'deep' ? 'Working' : 'Server responds') : row.outcome === 'broken' ? 'Not working' : 'Could not verify')}</span>
          </td>
        </tr>
      {/each}</tbody>
    </table>{/if}
    {#if !rows.length}
      <p class="empty">{t(!scan ? 'Scan this page to list its links.' : running ? 'Waiting for results…' : scan.total === 0 ? 'No HTTP links on this page.' : filter === 'Broken' && !query.trim() ? 'No broken links found.' : 'No links in this view.')}</p>
    {/if}
    {#if rows.length > visibleCount}<button class="more" onclick={() => visibleCount += 100}>{t('Show next {count} links', { count: Math.min(100, rows.length - visibleCount) })}</button>{/if}
  </section>

  {#if scan}
  <div class="page-options">
    <label class="flex items-center gap-2"><input type="checkbox" checked={scan?.highlighted ?? false}
      disabled={!scan || busy || running || stale || broken === 0}
      onchange={e => send('highlight', e.currentTarget.checked)} />{t('Highlight broken links on page')}</label>
    {#if scan?.truncated}<p class="hint">{t(scan.scope === 'site' ? 'Crawl limit reached' : 'Scan limited to 1,000 unique URLs / 20,000 link elements.')}</p>{/if}
    {#if scan?.skipped}<p class="hint">{t('Skipped non-HTTP or invalid links: {count}', { count: scan.skipped })}</p>{/if}
  </div>
  <footer class="export-toolbar flex items-center gap-2">
    <button disabled={!rows.length} onclick={copy}>{t('Copy results')}</button>
    <button disabled={!rows.length} onclick={download}>{t('Export CSV')}</button>
    <span class="result-count" aria-live={query ? 'polite' : 'off'} title={t('Copy and export use the current filter')}>{t('Shown: {count}', { count: rows.length })}</span>
  </footer>
  {/if}
  {#if project.websiteUrl || project.githubUrl}
    <nav class="project-links" aria-label="LinkGuard">
      {#if project.websiteUrl}<button data-project="support" onclick={() => browser.tabs.create({ url: new URL('#support', project.websiteUrl).href })}>{t('Support LinkGuard')} ↗</button>{/if}
      {#if project.githubUrl}<button data-project="github" onclick={() => browser.tabs.create({ url: project.githubUrl })}>GitHub ↗</button>{/if}
    </nav>
  {/if}
  {#if notice}<p class="notice" role="status">{t(notice, { count: noticeCount })}</p>{/if}
</main>
