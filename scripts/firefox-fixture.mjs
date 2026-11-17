import { createServer } from 'node:http';
const html = '<!doctype html><title>Example page</title><main><h1>Example article</h1><p>This page contains useful text for LinkGuard content checks.</p></main>';
const deepPaths = ['ok','soft404','app','challenge','login','empty','image-only','form-only','large','partial','unsupported','encoding','broken','redirect','slow'];
const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); res.end('User-agent: *\nDisallow: /crawl/blocked\n'); return; }
  if (req.url === '/audit') {
    res.setHeader('Set-Cookie', 'fixture_session=yes; Path=/; SameSite=Lax; HttpOnly');
    const paths = ['css-hidden','empty-main','delayed','rich-404','session-only','soft404'];
    res.end(`<h1>Deep verification audit</h1><ul>${paths.map(path => `<li><a href="/audit/${path}">${path}</a></li>`).join('')}</ul>`); return;
  }
  const audit = {
    '/audit/css-hidden': '<style>.hidden{display:none}</style><main class=hidden>Enough text to fool an HTML-only content checker.</main>',
    '/audit/empty-main': '<aside>A long sidebar is not the requested page content.</aside><main></main>',
    '/audit/delayed': '<main aria-busy=true>Loading the requested document, please wait.</main><script>setTimeout(()=>{const main=document.querySelector("main");main.textContent="The requested document has now loaded with useful content.";main.removeAttribute("aria-busy")},3500)</script>',
    '/audit/rich-404': html,
    '/audit/soft404': '<title>Page not found</title><main>The requested page does not exist. Try our search.</main>',
    '/audit/session-only': req.headers.cookie?.includes('fixture_session=yes') ? html : '<h1>Sign in</h1><form><input type=password></form>',
  };
  if (audit[req.url]) { res.statusCode = req.url === '/audit/rich-404' ? 404 : req.url === '/audit/session-only' && !req.headers.cookie?.includes('fixture_session=yes') ? 403 : 200; res.end(audit[req.url]); return; }
  const crawl = {
    '/crawl': ['/crawl/a','/crawl/b','/crawl/blocked','/logout',`http://127.0.0.1:${server.address().port}/crawl/external`],
    '/crawl/a': ['/crawl/b','/broken','/crawl'],
    '/crawl/b': ['/crawl/a','/broken'],
    '/crawl/external': ['/crawl/external-child'],
  };
  if (crawl[req.url]) { res.end(`${html}<ul>${crawl[req.url].map(path => `<li><a href="${path}">${path}</a></li>`).join('')}</ul>`); return; }
  if (req.url === '/') {
    res.end(`<!doctype html><title>LinkGuard Firefox fixture</title><h1>LinkGuard test page</h1>
      <p>Quick scan: 9 unique URLs, 2 broken, 2 unverified, 1 external, 1 skipped.</p>
      <ul><li><a href="/ok">200 OK</a></li><li><a href="/broken">404</a></li>
      <li><a href="/broken#again">Duplicate 404</a></li><li><a href="/gone">410</a></li>
      <li><a href="/head-rejected">HEAD 405 → GET 200</a></li><li><a href="/redirect">302 → 200</a></li>
      <li><a href="/forbidden">403 (unverified)</a></li><li><a href="/limited">429 (unverified)</a></li>
      <li><a href="http://127.0.0.1:${server.address().port}/ok">External origin</a></li>
      <li><a href="/slow">Slow response: close popup or press Stop</a></li>
      <li><a href="mailto:test@example.com">Skipped mailto</a></li></ul>`); return;
  }
  if (req.url === '/deep') {
    res.end(`<!doctype html><title>Deep scan fixture</title><h1>15 deep-check cases</h1><ul>${deepPaths.map(path => `<li><a href="/${path}">${path}</a></li>`).join('')}</ul>`); return;
  }
  if (req.url === '/resources') {
    const paths = ['valid-json','bad-json','problem-json','error-json','plain-text','body-error','email-login','attachment-html'];
    res.end(`<h1>Resource checks</h1><ul>${paths.map(path => `<li><a href="/${path}">${path}</a></li>`).join('')}</ul>`); return;
  }
  const resources = {
    '/valid-json': ['application/json', '{"items":[1,2,3]}'],
    '/bad-json': ['application/json', '{"items":'],
    '/problem-json': ['application/problem+json', '{"type":"about:blank","title":"Not found","status":404}'],
    '/error-json': ['application/json', '{"error":"Not found"}'],
    '/plain-text': ['text/plain', 'OK'],
    '/body-error': ['text/html', '<p>Service unavailable. Please try later.</p>'],
    '/email-login': ['text/html', '<h1>Sign in to continue</h1><form><input type="email"></form>'],
    '/attachment-html': ['text/html', '<h1>Page not found</h1>'],
  };
  if (resources[req.url]) {
    const [type, body] = resources[req.url];
    res.setHeader('Content-Type', type+'; charset=utf-8');
    if (req.url === '/attachment-html') res.setHeader('Content-Disposition', 'attachment; filename="example.html"');
    res.end(body); return;
  }
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok' }); res.end(); return; }
  if (req.url === '/slow') { setTimeout(() => { if (!res.destroyed) res.end(html); }, 4000); return; }
  if (req.url === '/limited') res.setHeader('Retry-After', '60');
  if (req.url === '/unsupported') res.setHeader('Content-Type', 'application/pdf');
  if (req.url === '/encoding') res.setHeader('Content-Type', 'text/html; charset=not-a-real-charset');
  res.statusCode = req.url === '/head-rejected' && req.method === 'HEAD' ? 405 : ({ '/broken':404, '/gone':410, '/forbidden':403, '/limited':429, '/partial':206 }[req.url] || 200);
  const bodies = {
    '/soft404':'<title>404 Not found</title><h1>Page not found</h1>',
    '/app':'<div id="root"></div><script>document.querySelector("#root").textContent="Content generated by JavaScript, not initial HTML."</script>',
    '/challenge':'<title>Just a moment</title><p>Verify you are human.</p>',
    '/login':'<h1>Sign in</h1><form><input type="password"></form>',
    '/empty':'', '/image-only':'<img src="/does-not-exist.png">', '/form-only':'<form><input name="search"></form>',
    '/large':'<p>'+'x'.repeat(1024*1024)+'</p>', '/unsupported':'%PDF-fixture',
  };
  res.end(bodies[req.url] ?? html);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => {
  console.log(`Quick: http://localhost:${server.address().port}/`);
  console.log(`Deep:  http://localhost:${server.address().port}/deep`);
  console.log(`Resources: http://localhost:${server.address().port}/resources`);
  console.log(`Audit: http://localhost:${server.address().port}/audit`);
  console.log(`Crawl: http://localhost:${server.address().port}/crawl`);
});
