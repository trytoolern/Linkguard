import { translate, type Locale } from './i18n.ts';
import { contentMessages } from './reasons.ts';
import type { Filter, Result } from './types';
export function filtered(results: Result[], filter: Filter): Result[] {
  return results.filter(r => filter === 'All' || (filter === 'Broken' ? r.outcome === 'broken' : filter === 'Unverified' ? ['uncertain', 'restricted'].includes(r.outcome) : r.kind === filter.toLowerCase()));
}
/** Local literal search; all whitespace-separated terms must match. No regex or network. */
export function searchResults(results: Result[], query: string, describe: (row: Result) => string = () => ''): Result[] {
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return results;
  return results.filter(row => {
    const fields = [row.url, row.finalUrl, row.status ?? '', row.kind, row.error, row.reason ?? '', describe(row)].join(' ');
    const decoded = [row.url, row.finalUrl].map(url => {
      try { return decodeURIComponent(url); } catch { return url; }
    }).join(' ');
    const text = fold(`${fields} ${decoded}`);
    return terms.every(term => text.includes(term));
  });
}
const columns = ['URL', 'HTTP status', 'Type', 'Outcome', 'Error type', 'Final URL', 'Occurrences', 'Method', 'Scan mode', 'Content check', 'Reason code', 'Checked in browser', 'Initial HTTP status', 'Source pages'];
function rows(results: Result[], locale: Locale) {
  const outcomes = { ok: 'Available', broken: 'Broken', restricted: 'Restricted', uncertain: 'Unverified' };
  return results.map(r => [r.url, r.status ?? '',
    locale === 'en' ? r.kind : translate(locale, r.kind === 'internal' ? 'Internal' : 'External'),
    locale === 'en' ? r.outcome : translate(locale, outcomes[r.outcome]),
    translate(locale, r.error), r.finalUrl, r.count, r.method, translate(locale, r.mode === 'deep' ? 'Deep scan' : 'Quick scan'), translate(locale, contentMessages[r.contentState ?? 'not-checked']), r.reason ?? 'http', r.browserChecked ? 'true' : 'false', r.httpStatus === undefined ? r.status ?? '' : r.httpStatus ?? '', (r.sources ?? []).join(' | ')]);
}
function safe(value: unknown): string { const s = String(value); return /^[\s]*[=+@-]/.test(s) ? `'${s}` : s; }
export function toCsv(results: Result[], locale: Locale = 'en'): string {
  return '\uFEFF' + [columns.map(column => translate(locale, column)), ...rows(results, locale)].map(row => row.map(value => `"${safe(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
export function toText(results: Result[], locale: Locale = 'en'): string {
  return [columns.map(column => translate(locale, column)), ...rows(results, locale)].map(row => row.map(value => safe(value).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n');
}
