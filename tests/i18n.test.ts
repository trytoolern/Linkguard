import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../locales/catalog.ts';
import { detectLocale, resolveLocale, translate, languages, languageGroups, getMessages, getDirection } from '../lib/i18n.ts';
import { toCsv, toText } from '../lib/export.ts';
import type { Result } from '../lib/types.ts';
import { readFileSync } from 'node:fs';
const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
test('all selectable languages have nonempty translations and matching placeholders', () => {
  assert.deepEqual(languages.map(l => l.code), ['en','zh-Hans','es','ar','fr','pt','ru','de','ja','ko','it','pl','uk','be','tr','uz','az','kk','ky','tt','tt-Latn','ba','sah']);
  for (const { code } of languages) {
    const messages = getMessages(code);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(catalog).sort(), `Incomplete dictionary: ${code}`);
    for (const [source, text] of Object.entries(messages)) {
      assert.ok(text.trim(), `${code}: ${source}`);
      assert.deepEqual(placeholders(text), placeholders(source), `${code}: ${source}`);
    }
  }
  for (const [source, translations] of Object.entries(catalog)) {
    assert.equal(translations.length, 5);
    for (const translation of translations) {
      assert.ok(translation.trim(), `Empty translation: ${source}`);
      assert.deepEqual(placeholders(translation), placeholders(source), source);
    }
  }
});
test('matches regional browser locales and honors the saved choice', () => {
  assert.equal(detectLocale(['ru-RU','en-US']), 'ru');
  assert.equal(detectLocale(['es_MX']), 'es');
  assert.equal(detectLocale(['fr-CA']), 'fr');
  assert.equal(detectLocale(['de-AT']), 'de');
  assert.equal(detectLocale(['tt-Cyrl-RU']), 'tt');
  assert.equal(detectLocale(['tt-Latn-RU']), 'tt-Latn');
  assert.equal(detectLocale(['TT_latn']), 'tt-Latn');
  assert.equal(detectLocale(['sah-RU']), 'sah');
  assert.equal(detectLocale(['kk-KZ']), 'kk');
  assert.equal(detectLocale(['ja-JP']), 'ja');
  assert.equal(resolveLocale('tt-Latn', ['ru']), 'tt-Latn');
  assert.equal(detectLocale(['pt-BR','fr']), 'pt');
  assert.equal(detectLocale(['zz']), 'en');
  assert.equal(resolveLocale('tt', ['ru']), 'tt');
  assert.equal(resolveLocale('invalid', ['ru']), 'ru');
});
test('interpolates counts including zero and leaves diagnostic details intact', () => {
  assert.equal(translate('ru','Checked: {count}',{count:0}), 'Проверено: 0');
  assert.equal(translate('tt','Broken: {count}',{count:3}), 'Бозылган: 3');
  assert.equal(translate('es','Unknown browser error: 123'), 'Unknown browser error: 123');
});
test('localizes exports while preserving URL, status, method and CSV escaping', () => {
  const result: Result = { url:'https://example.com/?a=1,2',finalUrl:'https://example.com/?a=1,2',kind:'internal',count:2,status:404,error:'Not found',outcome:'broken',method:'HEAD',elapsed:10 };
  for (const {code} of languages) {
    const csv=toCsv([result],code), text=toText([result],code);
    assert.ok(csv.startsWith('\uFEFF"URL"'));
    assert.ok(csv.includes('"https://example.com/?a=1,2"'));
    assert.ok(csv.includes('"404"')); assert.ok(csv.includes('"HEAD"'));
    assert.ok(csv.includes(translate(code,'Not found')));
    assert.ok(text.includes(translate(code,'HTTP status')));
  }
});
test('catalog covers all built-in background and HTTP error messages', () => {
  const background=readFileSync(new URL('../entrypoints/background.ts',import.meta.url),'utf8');
  const checker=readFileSync(new URL('../lib/checker.ts',import.meta.url),'utf8');
  const expressions=[...background.matchAll(/(?:new Error\(|state\.message = )'([^']+)'/g),...checker.matchAll(/error: '([^']+)'/g)];
  for(const match of expressions) assert.ok(catalog[match[1]!],`Missing message: ${match[1]}`);
});

test('Latin Tatar contains no accidental Cyrillic characters', () => {
  for (const [key, text] of Object.entries(getMessages('tt-Latn'))) assert.ok(!/\p{Script=Cyrillic}/u.test(text), key);
});

test('popular languages come first and regional languages remain at the bottom without duplicates', () => {
  assert.deepEqual(languageGroups, ['Popular languages', 'Turkic languages', 'Languages of Russia']);
  assert.equal(new Set(languages.map(language => language.code)).size, languages.length);
  const displayOrder = languageGroups.flatMap(group => languages.filter(language => language.group === group));
  assert.deepEqual(displayOrder.slice(0, 6).map(language => language.code), ['en', 'zh-Hans', 'es', 'ar', 'fr', 'pt']);
  assert.deepEqual(displayOrder.slice(-4).map(language => language.code), ['tt', 'tt-Latn', 'ba', 'sah']);
});

test('detects new regional tags without confusing Chinese scripts', () => {
  assert.equal(detectLocale(['zh-CN']), 'zh-Hans');
  assert.equal(detectLocale(['zh-Hans-SG']), 'zh-Hans');
  assert.equal(detectLocale(['zh-TW', 'en']), 'en');
  assert.equal(detectLocale(['zh-Hant', 'ja']), 'ja');
  assert.equal(detectLocale(['ar-EG']), 'ar');
  assert.equal(detectLocale(['ko-KR']), 'ko');
  assert.equal(detectLocale(['uk-UA']), 'uk');
  assert.equal(detectLocale(['be-BY']), 'be');
  for (const { code } of languages) assert.equal(getDirection(code), code === 'ar' ? 'rtl' : 'ltr');
});

test('deep exports preserve machine reason codes and localize content evidence', () => {
  const row: Result = { url: 'https://example.com/a', kind: 'external', count: 1, finalUrl: 'https://example.com/a', status: 200, outcome: 'uncertain', error: 'Possible error page', method: 'GET', elapsed: 50, mode: 'deep', contentState: 'suspected-error', reason: 'soft-error' };
  for (const { code } of languages) {
    const csv = toCsv([row], code);
    assert.ok(csv.includes(translate(code, 'Deep scan')));
    assert.ok(csv.includes(translate(code, 'Possible error page')));
    assert.ok(csv.includes('"soft-error"'));
    assert.ok(csv.includes('"200"'));
  }
});
