import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml } from '../lib/content.ts';

// Regression corpus, not a measured accuracy estimate for the public web.
const articles = [
  'How to fix a 404 error', '404 pages explained', '500 words about web servers',
  'Understanding service unavailable responses', 'Sign in with passkeys: a tutorial',
  'Access denied: troubleshooting guide', '404 — the history of HTTP',
  'Новости сайта', 'Руководство по разработке', 'Useful software documentation',
];
const errors = ['Page not found', '404 Not found', '410 Gone', '500 Internal server error',
  'Service unavailable', 'Страница не найдена', 'Страница удалена', 'Page introuvable',
  'Seite nicht gefunden', 'Página no encontrada', 'Página não encontrada',
  'Sayfa bulunamadı', 'Бет табылмады', 'Бит табылмады', 'ページが見つかりません', '页面不存在'];
for (const heading of articles) {
  // Bare error phrases are deliberately excluded from positive fixtures.
  if (/^(?:Access denied:|404 —)/.test(heading)) continue;
  for (const wrapper of ['main','article','div']) {
    test(`content corpus: article ${wrapper} / ${heading}`, () => {
      assert.equal(analyzeHtml(`<title>${heading}</title><${wrapper}><h1>${heading}</h1><p>This article explains the topic using examples, context and practical advice for developers.</p></${wrapper}>`).contentState, 'present');
    });
  }
}
for (const heading of errors) {
  for (const where of ['title','h1','body']) {
    test(`content corpus: error ${where} / ${heading}`, () => {
      const html = where === 'body' ? `<main>${heading}. Try again later.</main>` : `<${where}>${heading}</${where}><main>We could not retrieve the requested document.</main>`;
      assert.equal(analyzeHtml(html).contentState, 'suspected-error');
    });
  }
}
for (const hidden of ['hidden','aria-hidden="true"','style="display:none"','style="visibility:hidden"','class="cookie-banner"']) {
  test(`content corpus: excluded content / ${hidden}`, () => {
    assert.notEqual(analyzeHtml(`<div ${hidden}>This hidden content must not make the page green.</div>`).contentState, 'present');
  });
}
test('ambiguous error-prefixed article titles remain uncertain rather than confirmed broken', () => {
  assert.equal(analyzeHtml('<title>404 — the history of HTTP</title><main>This is an article about the history of response codes.</main>').contentState, 'suspected-error');
  assert.equal(analyzeHtml('<title>Access denied: troubleshooting guide</title><main>This article discusses common access problems and their solutions.</main>').contentState, 'challenge');
});
