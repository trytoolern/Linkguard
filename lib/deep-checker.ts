import { analyzeResource, supportsTextAnalysis, isJsonType } from './resource-content.ts';
import { classify } from './checker.ts';
import { reasonMessages } from './reasons.ts';
import type { Link, Result, ReasonCode } from './types.ts';

export const DEEP_DEFAULTS = { budgetMs: 20_000, attemptMs: 12_000, maxBytes: 1024 * 1024, retryDelayMs: 1000 };
class ContentError extends Error {
  readonly reason: ReasonCode;
  constructor(reason: ReasonCode) { super(reason); this.reason = reason; }
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
async function readTextResource(response: Response, signal: AbortSignal, maxBytes: number, received: (bytes: number) => void): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  if (!supportsTextAnalysis(type)) { discard(response); throw new ContentError('unsupported-content'); }
  const length = response.headers.get('content-length')?.trim();
  const encoded = response.headers.get('content-encoding')?.trim().toLowerCase();
  const declared = length && /^\d+$/.test(length) && (!encoded || encoded === 'identity') && Number.isSafeInteger(Number(length)) ? Number(length) : undefined;
  const sizeReason = type === 'text/html' ? 'size-limit' : 'resource-limit';
  if (declared !== undefined && declared > maxBytes) { discard(response); throw new ContentError(sizeReason); }
  if (!response.body) throw new ContentError('incomplete');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength; received(value.byteLength);
      if (size > maxBytes) throw new ContentError(sizeReason);
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (signal.aborted || error instanceof ContentError) throw error;
    throw new ContentError('incomplete');
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  if (declared !== undefined && declared !== size) throw new ContentError('incomplete');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  // Honor a declared charset, BOM, or an early HTML meta charset. No decoding guesses.
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 1024));
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined;
  const charset = isJsonType(type) ? 'utf-8' : bom ?? /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
    ?? (type === 'text/html' ? /<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i.exec(prefix)?.[1] : undefined) ?? 'utf-8';
  try { return new TextDecoder(charset, { fatal: true }).decode(bytes); }
  catch { throw new ContentError('encoding'); }
}
export function retryDelay(header: string | null, now: number, fallback: number): number {
  if (header === null) return fallback;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Math.max(fallback, Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(fallback, date - now) : fallback;
}
async function pause(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}
export async function checkDeepLink(link: Link, signal?: AbortSignal, settings: Partial<typeof DEEP_DEFAULTS> = {}): Promise<Result> {
  const options = { ...DEEP_DEFAULTS, ...settings };
  const started = Date.now();
  const deadline = AbortSignal.timeout(options.budgetMs);
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const result: Result = { ...link, mode: 'deep', contentState: 'not-checked', reason: 'http', attempts: 0, bytes: 0, status: null, outcome: 'uncertain', error: '', finalUrl: link.url, method: 'GET', elapsed: 0 };
  const finish = () => ({ ...result, elapsed: Date.now() - started });
  const fail = (reason: ReasonCode) => { result.reason = reason; result.error = reasonMessages[reason]; result.outcome = 'uncertain'; result.contentState = 'unverified'; };
  for (let attempt = 0; attempt < 2; attempt++) {
    let delay = options.retryDelayMs;
    try {
      overall.throwIfAborted();
      result.attempts = attempt + 1;
      result.status = null; result.finalUrl = link.url;
      const requestSignal = AbortSignal.any([overall, AbortSignal.timeout(options.attemptMs)]);
      const response = await abortable(fetch(link.url, { method: 'GET', redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: requestSignal }), requestSignal);
      result.attachment = /^\s*attachment(?:\s*;|\s*$)/i.test(response.headers.get('content-disposition') ?? '');
      result.contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      result.status = response.status; result.finalUrl = response.url || link.url;
      delay = retryDelay(response.headers.get('retry-after'), Date.now(), delay);
      if (response.status < 200 || response.status >= 300) {
        discard(response);
        Object.assign(result, classify(response.status));
        if (result.outcome === 'ok') { fail('unsupported-content'); return finish(); }
        if (response.status >= 500) fail('server-error');
        if (![429, 502, 503, 504].includes(response.status)) return finish();
      } else {
        if (response.status === 206) { discard(response); fail('incomplete'); return finish(); }
        const text = await readTextResource(response, requestSignal, options.maxBytes, n => { result.bytes! += n; });
        const analysis = analyzeResource(text, result.contentType ?? '');
        overall.throwIfAborted();
        if (Date.now() - started >= options.budgetMs) { fail('timeout'); return finish(); }
        Object.assign(result, analysis);
        result.outcome = analysis.contentState === 'present' ? 'ok' : ['login', 'challenge'].includes(analysis.contentState) ? 'restricted' : 'uncertain';
        result.error = analysis.contentState === 'present' ? '' : reasonMessages[analysis.reason];
        return finish();
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ContentError) { fail(error.reason); return finish(); }
      fail(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (attempt === 1 || overall.aborted || Date.now() - started + delay >= options.budgetMs) return finish();
    try { await pause(delay, overall); }
    catch { if (signal?.aborted) throw signal.reason; fail('timeout'); return finish(); }
  }
  return finish();
}
