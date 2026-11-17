import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, collectLinks } from '../lib/urls.ts';
import { classify, checkLink } from '../lib/checker.ts';
import { filtered, searchResults, toCsv, toText } from '../lib/export.ts';
import type { Result } from '../lib/types.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const link = { url: 'https://example.com/a', kind: 'internal' as const, count: 1 };
const result: Result = { ...link, status: 404, outcome: 'broken', error: 'Not found', finalUrl: link.url, method: 'HEAD', elapsed: 10 };
test('normalizes relative URLs, strips fragments, preserves query strings', () => {
  assert.equal(normalizeUrl('../docs?q=1#part', 'https://EXAMPLE.com:443/a/b'), 'https://example.com/docs?q=1');
  assert.equal(normalizeUrl('//other.test/a', 'https://example.com'), 'https://other.test/a');
});
test('rejects non HTTP schemes, invalid URLs and embedded credentials', () => {
  for (const raw of ['mailto:a@b.com','tel:123','javascript:alert(1)','data:text/html,x','file:///x','https://user:pass@x.test','http://[invalid']) assert.equal(normalizeUrl(raw, link.url), null);
});
test('SPA hash routes stay distinct while ordinary document anchors deduplicate', () => {
  const urls = collectLinks(['/#/one','/#/two','/#!/three','/article#one','/article#two'], 'https://example.com').links;
  assert.equal(urls.length, 4);
  assert.equal(urls[0]?.url, 'https://example.com/#/one');
  assert.equal(urls[1]?.url, 'https://example.com/#/two');
  assert.equal(urls[2]?.url, 'https://example.com/#!/three');
  assert.equal(urls[3]?.count, 2);
});
test('deduplicates, counts occurrences, classifies same origin and bounds large pages', () => {
  const data = collectLinks(['/a#one','/a#two','https://other.test/a','http://example.com/a','/b','mailto:a@b'], 'https://example.com', 3);
  assert.deepEqual(data.links.map(r => [r.kind, r.count]), [['internal',2],['external',1],['external',1]]);
  assert.equal(data.truncated, true); assert.equal(data.skipped, 1);
});
test('classifies real HTTP failures separately from restrictions', () => {
  for (const status of [200,204,206,301,308]) assert.equal(classify(status).outcome, 'ok');
  for (const status of [404,410]) assert.equal(classify(status).outcome, 'broken');
  for (const status of [401,403,429]) assert.equal(classify(status).outcome, 'restricted');
  for(const status of [0,500,502,503,504])assert.equal(classify(status).outcome, 'uncertain');
});
test('HEAD falls back to GET and cancels response body', async () => {
  const calls: RequestInit[] = []; let cancelled = false;
  globalThis.fetch = async (_, init) => {
    calls.push(init!);
    return calls.length === 1 ? new Response(null, { status: 405 }) : new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
  };
  const r = await checkLink(link);
  assert.equal(r.status,200); assert.equal(r.method,'GET'); assert.equal(cancelled,true);
  assert.deepEqual(calls.map(c=>c.method), ['HEAD','GET']);
  assert.equal(calls[0]!.credentials,'omit'); assert.equal(calls[0]!.referrerPolicy,'no-referrer');
});
test('fallback covers HEAD incompatibilities but does not retry rate limits', async () => {
  for (const status of [400,403,404,405,410,501,429,503]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status }); };
    await checkLink(link);
    assert.equal(calls, [400,403,404,405,410,501].includes(status) ? 2 : 1);
  }
});
test('network failures remain unverified', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await checkLink(link); assert.equal(r.status,null); assert.equal(r.outcome,'uncertain');
});
test('timeout has its own error type', async () => {
  globalThis.fetch = async () => { throw new DOMException('Timed out','TimeoutError'); };
  assert.equal((await checkLink(link)).error,'Timeout');
});
test('cancellation propagates without producing a false broken link', async () => {
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async (_, init) => { init!.signal!.throwIfAborted(); return new Response(); };
  await assert.rejects(checkLink(link, controller.signal));
});
test('exports correctly quoted CSV and prevents spreadsheet formula injection', () => {
  const rows = [{ ...result, error: 'Server says "bad", retry\nsoon' }, { ...result, error: '=HYPERLINK("x")' }];
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('\uFEFF"URL"')); assert.ok(csv.includes('"Server says ""bad"", retry\nsoon"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.equal(toText(rows).split('\n').length,3);
});
test('filters broken links independently of internal/external classification', () => {
  const rows: Result[] = [result,{ ...result, url:'https://other.test', kind:'external', status:403,outcome:'restricted' }];
  assert.equal(filtered(rows,'All').length,2); assert.equal(filtered(rows,'Broken').length,1);
  assert.equal(filtered(rows,'Internal')[0]?.url,link.url); assert.equal(filtered(rows,'External').length,1);
});
test('export keeps unknown original HTTP status empty after a successful browser navigation', () => {
  const text = toText([{ ...result, status: 200, httpStatus: null, browserChecked: true, sources: ['https://example.com/source'] }]);
  const values = text.split('\n')[1]!.split('\t');
  assert.equal(values[1], '200'); assert.equal(values[12], ''); assert.equal(values[13], 'https://example.com/source');
});

test('HEAD not-found is confirmed by GET before calling a link broken',async()=>{
  for(const headStatus of [404,410]){
    globalThis.fetch=async(_,init)=>new Response(null,{status:init?.method==='HEAD'?headStatus:200});
    const working=await checkLink(link);
    assert.equal(working.status,200);assert.equal(working.outcome,'ok');assert.equal(working.method,'GET');
    globalThis.fetch=async()=>new Response(null,{status:headStatus});
    assert.equal((await checkLink(link)).outcome,'broken');
  }
});
test('GET failures after a HEAD rejection stay uncertain and cancellation stops the fallback',async()=>{
  globalThis.fetch=async(_,init)=>{if(init?.method==='GET')throw new TypeError('Blocked');return new Response(null,{status:404});};
  assert.equal((await checkLink(link)).outcome,'uncertain');
  const controller=new AbortController();let calls=0;
  globalThis.fetch=async(_,init)=>{calls++;init?.signal?.throwIfAborted();controller.abort();return new Response(null,{status:404});};
  await assert.rejects(checkLink(link,controller.signal));
  assert.ok(calls<=2);
});
test('result search composes with filters and supports literal, decoded and localized text',()=>{
  const rows:Result[]=[result,{...result,url:'https://other.test/%D1%82%D0%B5%D1%81%D1%82',kind:'external',status:403,outcome:'restricted',error:'Access denied'},
    {...result,url:'https://example.com/%broken',status:null,outcome:'uncertain',error:'Network / TLS / blocked'}];
  assert.equal(filtered(rows,'Unverified').length,2);
  assert.equal(searchResults(rows,'403 external')[0]?.kind,'external');
  assert.equal(searchResults(rows,'тест')[0]?.kind,'external');
  assert.equal(searchResults([{...rows[1]!,finalUrl:'https://example.com/%bad'}],'тест').length,1);
  assert.equal(searchResults(rows,'acces',()=> 'Accès refusé').length,3);
  assert.equal(searchResults(rows,'[').length,0,'Search text is not a regex');
  assert.equal(searchResults(rows,'%broken').length,1);
  assert.equal(searchResults(rows,'   '),rows);
  assert.equal(filtered(searchResults(rows,'403'),'Broken').length,0);
});
