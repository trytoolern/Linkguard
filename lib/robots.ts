import { withAbort } from './abort.ts';
type Rule = { allow: boolean; pattern: string; length: number; end: boolean };
// Greedy wildcard matcher avoids exponential regular expressions from remote text.
function matches(pattern: string, path: string, end: boolean): boolean {
  let p = 0, at = 0, star = -1, backtrack = 0;
  while (at < path.length) {
    if (p === pattern.length && !end) return true;
    if (pattern[p] === '*') { star = p++; backtrack = at; }
    else if (pattern[p] === path[at]) { p++; at++; }
    else if (star >= 0) { p = star + 1; at = ++backtrack; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}
function octets(value: string): string {
  return value.replace(/[^\x21-\x7e]/gu, char => encodeURIComponent(char)).replace(/%([a-f\d]{2})/gi, (whole, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16)); return /[a-z\d._~-]/i.test(c) ? c : whole.toUpperCase();
  });
}
export function parseRobots(text: string): (url: string) => boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let group: typeof groups[number] | undefined, directives = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.split('#')[0]!.trim(); const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!group || directives) { group = { agents: [], rules: [] }; groups.push(group); directives = false; }
      group.agents.push(value.toLowerCase()); continue;
    }
    if (!group || !['allow','disallow'].includes(key)) continue;
    directives = true; if (!value.startsWith('/')) continue;
    const normalized = octets(value), end = normalized.endsWith('$');
    const body = end ? normalized.slice(0, -1) : normalized;
    if (body.length > 4096) return () => false;
    group.rules.push({ allow: key === 'allow', pattern: body, end, length: new TextEncoder().encode(body.replaceAll('*', '')).length });
  }
  const named = groups.filter(g => g.agents.includes('linkguard'));
  const rules = (named.length ? named : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  return raw => {
    const url = new URL(raw), path = octets(url.pathname + url.search); let best: Rule | undefined;
    for (const rule of rules) if (matches(rule.pattern, path, rule.end) && (!best || rule.length > best.length || rule.length === best.length && rule.allow)) best = rule;
    return best?.allow ?? true;
  };
}
export function robotsGate(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, Promise<(url: string) => boolean>>();
  return async (url: string, signal: AbortSignal): Promise<boolean> => {
    const origin = new URL(url).origin;
    if (!cache.has(origin)) cache.set(origin, (async () => {
      try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
        const response = await withAbort(fetcher(`${origin}/robots.txt`, { credentials: 'omit', redirect: 'follow', signal: requestSignal }), requestSignal);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) { void response.body?.cancel().catch(() => {}); return () => true; }
        if (!response.ok) { void response.body?.cancel().catch(() => {}); return () => false; }
        if (!response.body) return () => false;
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await withAbort(reader.read(), requestSignal); if (done) break;
            size += value.byteLength; if (size > 512 * 1024) { await reader.cancel(); return () => false; } chunks.push(value);
          }
        } catch (error) { void reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        return parseRobots(new TextDecoder().decode(bytes));
      } catch { signal.throwIfAborted(); return () => false; }
    })());
    return (await cache.get(origin)!)(url);
  };
}
