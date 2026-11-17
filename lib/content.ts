import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { ContentState, ReasonCode } from './types.ts';
export interface ContentAnalysis { contentState: ContentState; reason: ReasonCode }
type Node = DefaultTreeAdapterMap['node'];
const ignored = new Set(['script', 'style', 'template', 'noscript', 'nav', 'header', 'footer', 'svg', 'head']);
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
// Deliberately anchored: an article discussing 404 must not become a soft 404.
const notFound = /^(?:(?:error|ошибка)\s*)?(?:404|410|500|502|503|504)(?:\s*[:–—-]|\s+(?:not found|page not found|gone|internal server error|service unavailable|bad gateway|gateway timeout|ошибка|страница не найдена)(?:\s|[.!]|$)|[.!]?$)|^(?:page not found|not found|internal server error|service unavailable|bad gateway|gateway timeout|sorry,? (?:this |the )?page (?:could not be found|does not exist)|страница не найдена|страница удалена|внутренняя ошибка сервера|сервис недоступен|page introuvable|seite nicht gefunden|página no encontrada|pagina non trovata|página não encontrada|сторінку не знайдено|sayfa bulunamadı|бет табылмады|бит табылмады|الصفحة غير موجودة|ページが見つかりません|お探しのページは見つかりません|페이지를 찾을 수 없습니다|页面不存在|页面未找到)(?:[.!\s|:–—-]|$)/i;
const challenge = /^(?:just a moment|verify (?:you are|that you are) human|checking your browser|checking if the site connection is secure|attention required|access denied|доступ запрещ[её]н|подтвердите, что вы человек)(?:[.!\s|:–—-]|$)/i;
const login = /^(?:sign in|log in|login|вход|авторизация|connexion|anmelden|iniciar sesión)(?:[.!\s|:–—-]|$)/i;

/** Pure parsing: no DOM attachment, resource loading, JS execution, or layout. */
export function analyzeHtml(html: string): ContentAnalysis {
  const root = parse(html);
  let title = '', heading = '', text = '', mainText = '', media = false, form = false, script = false, password = false;
  const stack: { node: Node; excluded: boolean; inMain: boolean; inTitle: boolean; inHeading: boolean }[] = [{ node: root, excluded: false, inMain: false, inTitle: false, inHeading: false }];
  while (stack.length) {
    const { node, excluded, inMain, inTitle, inHeading } = stack.pop()!;
    if (node.nodeName === '#text' && 'value' in node) {
      if (inTitle) title += node.value;
      if (inHeading && !excluded) heading += node.value;
      if (!excluded) { text += ` ${node.value}`; if (inMain) mainText += ` ${node.value}`; }
      continue;
    }
    if (!('childNodes' in node)) continue;
    const tag = node.nodeName;
    const attrs = 'attrs' in node ? Object.fromEntries(node.attrs.map(a => [a.name, a.value])) : {};
    const hidden = 'hidden' in attrs || attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? '');
    const boilerplate = /(?:cookie|consent|banner|navigation)/i.test(`${attrs.id ?? ''} ${attrs.class ?? ''}`) || ['navigation', 'banner', 'contentinfo', 'dialog'].includes(attrs.role ?? '');
    const skip = excluded || ignored.has(tag) || hidden || boilerplate;
    if (tag === 'script') script = true;
    if (!skip) {
      if (tag === 'input' && attrs.type?.toLowerCase() === 'password') password = true;
      if (tag === 'input' && !['hidden', 'submit', 'button'].includes(attrs.type?.toLowerCase() ?? '') || tag === 'textarea' || tag === 'select') form = true;
      if (['img', 'video', 'audio', 'source'].includes(tag) && (attrs.src || attrs.srcset)) media = true;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i]!, excluded: skip, inMain: inMain || tag === 'main' || tag === 'article' || attrs.role === 'main', inTitle: inTitle || tag === 'title', inHeading: inHeading || tag === 'h1' });
  }
  return classifyContent({ title, heading, text: mainText.trim() || text, media, form, script, password });
}

export interface ContentEvidence {
  title: string; heading: string; text: string;
  media: boolean; form: boolean; script: boolean; password: boolean; loadedMedia?: boolean; busy?: boolean;
}
export function classifyContent(evidence: ContentEvidence): ContentAnalysis {
  const { media, form, script, password, loadedMedia } = evidence;
  const title = normalize(evidence.title), heading = normalize(evidence.heading), text = normalize(evidence.text);
  const shortBody = !heading && text.length <= 400 ? text : '';
  if ([title, heading, shortBody].some(value => challenge.test(value))) return { contentState: 'challenge', reason: 'challenge' };
  if ((password || form) && [title, heading].some(value => login.test(value))) return { contentState: 'login', reason: 'login' };
  if ([title, heading, shortBody].some(value => notFound.test(value))) return { contentState: 'suspected-error', reason: 'soft-error' };
  if (evidence.busy) return { contentState: 'needs-browser', reason: 'needs-browser' };
  if (text.length < 160 && /^(?:loading|please wait|загрузка|пожалуйста, подождите)(?:[.\s…!]|$)/i.test(text)) return { contentState: 'needs-browser', reason: 'needs-browser' };
  if (loadedMedia) return { contentState: 'present', reason: 'content-found' };
  // Text is positive evidence, never a guarantee that CSS renders it visibly.
  if (text.length >= 20 && /\p{L}/u.test(text)) return { contentState: 'present', reason: 'content-found' };
  if (form) return { contentState: 'unverified', reason: 'form-unverified' };
  if (media) return { contentState: 'unverified', reason: 'media-unverified' };
  if (script) return { contentState: 'needs-browser', reason: 'needs-browser' };
  if (text) return { contentState: 'unverified', reason: 'insufficient-content' };
  return { contentState: 'empty', reason: 'empty-content' };
}
