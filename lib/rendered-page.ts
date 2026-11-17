import type { ContentEvidence } from './content.ts';
export interface RenderedPage extends ContentEvidence { url: string; truncated: boolean; readyState?: string; links?: string[]; linksTruncated?: boolean }
/** Self-contained function injected into the TOP frame. Reads only; never clicks or submits. */
export function readRenderedPage(): RenderedPage {
  const result: RenderedPage = { url: location.href, title: document.title.slice(0, 1000), heading: '', text: '', media: false, loadedMedia: false, form: false, password: false, script: !!document.querySelector('script'), truncated: false, readyState: document.readyState, links: [], linksTruncated: false };
  // Link discovery includes menus, but ignores action/download anchors. No clicks.
  const roots: (Document | ShadowRoot)[] = [document];
  let inspected = 0;
  while (roots.length && inspected < 20_000) {
    const root = roots.pop()!;
    for (const node of root.querySelectorAll('*')) {
      if (++inspected > 20_000) { result.linksTruncated = true; break; }
      if (node.shadowRoot) roots.push(node.shadowRoot);
      if (!['A','AREA'].includes(node.tagName) || !node.hasAttribute('href') || node.hasAttribute('download')) continue;
      if (result.links!.length >= 2000) { result.linksTruncated = true; continue; }
      const href = node.getAttribute('href')!;
      if (href.length > 8192) { result.linksTruncated = true; continue; }
      try { const url = new URL(href, node.baseURI).href; if (url.length <= 8192) result.links!.push(url); else result.linksTruncated = true; } catch { /* Invalid link. */ }
    }
  }
  if (roots.length) result.linksTruncated = true;
  const main = document.querySelector('main, [role="main"]') ?? document.querySelector('article');
  let mainText = '';
  let visited = 0;
  const ignored = new Set(['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','NAV','HEADER','FOOTER','HEAD','SVG']);
  const stack: { node: Node; heading: boolean; inMain: boolean }[] = document.body ? [{ node: document.body, heading: false, inMain: false }] : [];
  while (stack.length) {
    const { node, heading, inMain } = stack.pop()!;
    if (++visited > 10_000 || result.text.length > 30_000) { result.truncated = true; break; }
    if (node.nodeType === Node.TEXT_NODE) { if (main && !inMain) continue; const text = ` ${node.textContent ?? ''}`; result.text += text; if (inMain) mainText += text; if (heading) result.heading += text.slice(0, 1000); continue; }
    if (!(node instanceof Element)) continue;
    if (main && !inMain && node !== main && !node.contains(main)) continue;
    if (ignored.has(node.tagName) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') continue;
    const role = node.getAttribute('role') ?? '';
    const identity = `${node.id} ${node.getAttribute('class') ?? ''}`;
    if (['navigation','banner','contentinfo','dialog'].includes(role) || /(?:cookie|consent|navigation)/i.test(identity)) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') continue;
    const bounds = node.getBoundingClientRect();
    if ((style.overflow === 'hidden' || style.overflow === 'clip') && (bounds.width === 0 || bounds.height === 0)) continue;
    if (node.getAttribute('aria-busy') === 'true' && (!main || inMain || node === main || node.contains(main))) result.busy = true;
    if (node instanceof HTMLInputElement) {
      if (node.type === 'password') result.password = true;
      if (!['hidden','submit','button'].includes(node.type)) result.form = true;
    }
    if (['TEXTAREA','SELECT'].includes(node.tagName)) result.form = true;
    if (node instanceof HTMLImageElement) {
      result.media = true;
      const bounds = node.getBoundingClientRect();
      if (node.complete && node.naturalWidth > 32 && node.naturalHeight > 32 && bounds.width > 32 && bounds.height > 32) result.loadedMedia = true;
    }
    if (node instanceof HTMLMediaElement) { result.media = true; if (node.readyState >= 2) result.loadedMedia = true; }
    const children = node instanceof HTMLSlotElement ? node.assignedNodes({ flatten: true }) : node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes];
    const descendants = children.length ? children : [...node.childNodes];
    for (let i = descendants.length - 1; i >= 0; i--) stack.push({ node: descendants[i]!, heading: heading || node.tagName === 'H1', inMain: inMain || node === main });
  }
  result.text = (main ? mainText : result.text).replace(/\s+/g, ' ').trim();
  result.heading = result.heading.trim();
  return result;
}
