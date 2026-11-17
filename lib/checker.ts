import type { Link, Outcome, Result } from './types';
export function classify(status: number): { outcome: Outcome; error: string } {
  if (status >= 200 && status < 400) return { outcome: 'ok', error: '' };
  if (status === 401) return { outcome: 'restricted', error: 'Authentication required' };
  if (status === 403) return { outcome: 'restricted', error: 'Access denied' };
  if (status === 429) return { outcome: 'restricted', error: 'Rate limited' };
  if (status === 404) return { outcome: 'broken', error: 'Not found' };
  if (status === 410) return { outcome: 'broken', error: 'Gone' };
  if (status >= 500) return { outcome: 'uncertain', error: 'Server error' };
  if (status >= 400) return { outcome: 'broken', error: 'HTTP error' };
  return { outcome: 'uncertain', error: 'Unverifiable response' };
}
export async function checkLink(link: Link, signal?: AbortSignal, timeoutMs = 12000): Promise<Result> {
  const started = Date.now();
  let method: 'HEAD' | 'GET' = 'HEAD';
  const request = async () => {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(link.url, {
      method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    await response.body?.cancel();
    return response;
  };
  try {
    let response = await request();
    // Some routes reject HEAD with 404/410 despite serving a valid GET page.
    if ([400, 403, 404, 405, 410, 501].includes(response.status)) { method = 'GET'; response = await request(); }
    return { ...link, status: response.status, ...classify(response.status), finalUrl: response.url || link.url, method, elapsed: Date.now() - started };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...link, status: null, outcome: 'uncertain', error: error instanceof Error && error.name === 'TimeoutError' ? 'Timeout' : 'Network / TLS / blocked', finalUrl: link.url, method, elapsed: Date.now() - started };
  }
}
