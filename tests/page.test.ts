import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readPage, markPage } from '../lib/page.ts';
function page(html: string) {
  const window = new Window({ url: 'https://example.com/page' });
  window.document.body.innerHTML = html;
  Object.assign(globalThis, { document: window.document, location: window.location });
  return window;
}
afterEach(() => { delete (globalThis as any).__linkguard_marks_v1; });
test('collection resolves base URI, includes open shadow roots and ignores iframes', () => {
  const window = page('<base href="https://cdn.test/"><a href="docs#section">Docs</a><a href="mailto:a@b">Mail</a><div id="host"></div><iframe></iframe>');
  const shadow = window.document.getElementById('host')!.attachShadow({ mode:'open' });
  shadow.innerHTML = '<a href="nested">Nested</a>';
  assert.deepEqual(readPage().hrefs, ['https://cdn.test/docs#section','mailto:a@b','https://cdn.test/nested']);
});
test('highlights every occurrence and restores existing inline styles exactly', () => {
  const window = page('<a href="/bad" style="outline: 3px dashed blue !important; outline-offset: 4px">Bad</a><a href="/bad#x">Again</a><a href="/good">Good</a>');
  const links = window.document.querySelectorAll('a');
  const before = links[0]!.style.cssText;
  assert.equal(markPage(['https://example.com/bad'],window.location.href),true);
  assert.equal(links[0]!.style.outlineColor,'rgb(190, 50, 55)');
  assert.equal(links[1]!.style.outlineColor,'rgb(190, 50, 55)');
  assert.equal(links[2]!.style.outline,'');
  markPage([],window.location.href);
  assert.equal(links[0]!.style.cssText,before); assert.equal(links[1]!.style.outline,'');
});
test('repeated highlight toggles do not accumulate changed styles', () => {
  const window = page('<a href="/bad">Bad</a>');
  markPage(['https://example.com/bad'],window.location.href); markPage(['https://example.com/bad'],window.location.href); markPage([],window.location.href);
  assert.equal(window.document.querySelector('a')!.style.outline,'');
});
test('stale page results never mutate the new page', () => {
  const window = page('<a href="/bad">Bad</a>');
  assert.equal(markPage(['https://example.com/bad'],'https://example.com/old'),false);
  assert.equal(window.document.querySelector('a')!.style.outline,'');
});
test('keeps an outline changed by the page after highlighting', () => {
  const window = page('<a href="/bad">Bad</a>'); const node = window.document.querySelector('a')!;
  markPage(['https://example.com/bad'],window.location.href); node.style.outline='4px dotted green'; markPage([],window.location.href);
  assert.equal(node.style.outlineColor,'green'); assert.equal(node.style.outlineWidth,'4px');
});
