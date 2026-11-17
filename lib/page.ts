// Injected functions must be self-contained: scripting.executeScript serializes their bodies.
export function readPage() {
  const hrefs: string[] = [];
  let overflow = false;
  function walk(root: Document | ShadowRoot) {
    for (const node of root.querySelectorAll('a[href], area[href]')) {
      if (hrefs.length >= 20000) { overflow = true; break; }
      try { hrefs.push(new URL(node.getAttribute('href')!, node.baseURI).href); } catch { hrefs.push(node.getAttribute('href')!); }
    }
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot && !overflow) walk(node.shadowRoot);
  }
  walk(document);
  return { hrefs, pageUrl: location.href, overflow };
}
export function markPage(urls: string[], expectedUrl: string) {
  if (location.href !== expectedUrl) return false;
  const targets = new Set(urls);
  const key = '__linkguard_marks_v1';
  const host = globalThis as typeof globalThis & { [key: string]: unknown };
  const previous = host[key] as { node: Element; outline: string; priority: string; offset: string; offsetPriority: string; appliedOutline: string; appliedOffset: string }[] | undefined;
  for (const saved of previous ?? []) {
    const node = saved.node as HTMLElement;
    if (node.style.getPropertyValue('outline') === saved.appliedOutline && node.style.getPropertyPriority('outline') === 'important') {
      node.style.setProperty('outline', saved.outline, saved.priority);
    }
    if (node.style.getPropertyValue('outline-offset') === saved.appliedOffset && node.style.getPropertyPriority('outline-offset') === 'important') {
      node.style.setProperty('outline-offset', saved.offset, saved.offsetPriority);
    }
  }
  const marks: NonNullable<typeof previous> = [];
  function walk(root: Document | ShadowRoot) {
    for (const node of root.querySelectorAll<HTMLElement>('a[href], area[href]')) {
      try {
        const url = new URL(node.getAttribute('href')!, node.baseURI); if (!/^#!?\//.test(url.hash)) url.hash = '';
        if (!targets.has(url.href)) continue;
        const saved = { node, outline: node.style.getPropertyValue('outline'), priority: node.style.getPropertyPriority('outline'), offset: node.style.getPropertyValue('outline-offset'), offsetPriority: node.style.getPropertyPriority('outline-offset'), appliedOutline: '', appliedOffset: '' };
        node.style.setProperty('outline', '2px solid rgb(190, 50, 55)', 'important');
        node.style.setProperty('outline-offset', '2px', 'important');
        saved.appliedOutline = node.style.getPropertyValue('outline');
        saved.appliedOffset = node.style.getPropertyValue('outline-offset');
        marks.push(saved);
      } catch { /* malformed URL */ }
    }
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) walk(node.shadowRoot);
  }
  if (targets.size) walk(document);
  host[key] = marks;
  return true;
}
