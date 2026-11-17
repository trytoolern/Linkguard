import type { Link } from './types';
export function normalizeUrl(raw: string, base: string): string | null {
  try {
    if (raw.length > 8192) return null;
    const url = new URL(raw, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    // Keep common SPA router fragments; ordinary document anchors share one check.
    if (!/^#!?\//.test(url.hash)) url.hash = '';
    return url.href;
  } catch { return null; }
}
export function collectLinks(hrefs: string[], base: string, limit = 1000): { links: Link[]; skipped: number; truncated: boolean } {
  const links = new Map<string, Link>();
  let skipped = 0, truncated = false;
  const origin = new URL(base).origin;
  for (const href of hrefs) {
    const url = normalizeUrl(href, base);
    if (!url) { skipped++; continue; }
    const existing = links.get(url);
    if (existing) { existing.count++; continue; }
    if (links.size >= limit) { truncated = true; continue; }
    links.set(url, { url, kind: new URL(url).origin === origin ? 'internal' : 'external', count: 1 });
  }
  return { links: [...links.values()], skipped, truncated };
}
