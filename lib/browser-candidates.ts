import type { Result } from './types.ts';
/** Deep HTML needs visible evidence, including pages that look valid in source. */
export function canCheckInBrowser(row: Result): boolean {
  if (row.attachment || (row.contentType !== undefined && row.contentType !== 'text/html')) return false;
  if (row.mode !== 'deep' || row.browserChecked || row.reason === 'crawl-skipped') return false;
  if (row.status === 429 || (row.status !== null && row.status >= 500)) return false;
  if (row.status !== null && row.status >= 400 && row.status < 500) return row.contentType === 'text/html';
  if (row.status !== null && row.status >= 400) return false;
  if (row.contentType === 'text/html' && row.status !== null && row.status >= 200 && row.status < 300) return true;
  if (row.status === null && ['network', 'timeout'].includes(row.reason ?? '')) return true;
  return ['login','needs-browser','form-unverified','media-unverified','insufficient-content','empty-content','soft-error','size-limit','encoding','incomplete'].includes(row.reason ?? '');
}
