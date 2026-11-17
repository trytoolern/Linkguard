import { pslRules } from './psl-rules.ts';
import { normalizeUrl } from './urls.ts';
const exact = new Set<string>(), wildcard = new Set<string>(), exceptions = new Set<string>();
for (const rule of pslRules.split('\n')) {
  const target = rule.startsWith('!') ? exceptions : rule.startsWith('*.') ? wildcard : exact;
  try { target.add(new URL(`https://${rule.replace(/^(?:!|\*\.)/, '')}`).hostname); } catch { /* Invalid upstream entry. */ }
}
/** Longest PSL match, including wildcard/exception and PRIVATE hosted domains. */
export function registrableDomain(host: string): string | undefined {
  const hostname = new URL(`https://${host}`).hostname.replace(/\.$/, '');
  if (hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)) return;
  const labels = hostname.split('.'); let suffix = 0;
  for (let i = 0; i < labels.length; i++) {
    const part = labels.slice(i).join('.');
    if (exceptions.has(part)) return part;
    if (exact.has(part)) suffix = Math.max(suffix, labels.length - i);
    if (i > 0 && wildcard.has(part)) suffix = Math.max(suffix, labels.length - i + 1);
  }
  return suffix > 0 && labels.length > suffix ? labels.slice(-suffix - 1).join('.') : undefined;
}
export function siteScope(seed: string): (raw: string) => boolean {
  const base = new URL(seed), domain = registrableDomain(base.hostname);
  return raw => {
    const normalized = normalizeUrl(raw, seed); if (!normalized) return false;
    const url = new URL(normalized);
    if (!domain) return url.origin === base.origin;
    return url.port === base.port && registrableDomain(url.hostname) === domain;
  };
}
/** Skip clearly state-changing action URLs before any check is sent. */
export function isActionUrl(raw: string): boolean {
  const url = new URL(raw); let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return true; }
  const action = /(?:^|[\/_\-.\s])(?:log-?out|sign-?out|delete|remove|unsubscribe|checkout|purchase|destroy)(?:$|[\/_\-.\s])/i;
  if (action.test(path)) return true;
  for (const [name, value] of url.searchParams) if (action.test(name) || /^(?:action|do|cmd|operation)$/i.test(name) && action.test(value)) return true;
  return false;
}
