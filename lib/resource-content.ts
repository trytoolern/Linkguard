import { analyzeHtml, classifyContent, type ContentAnalysis } from './content.ts';
export function isJsonType(type: string): boolean {
  return type === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(type);
}
export function supportsTextAnalysis(type: string): boolean {
  return type === 'text/html' || type === 'text/plain' || isJsonType(type);
}
/** Validate data without executing it or fetching any referenced resources. */
export function analyzeResource(text: string, type: string): ContentAnalysis {
  if (type === 'text/html') return analyzeHtml(text);
  if (!text.trim()) return { contentState: 'empty', reason: 'empty-content' };
  if (isJsonType(type)) {
    let data: unknown;
    try { data = JSON.parse(text); }
    catch { return { contentState: 'unverified', reason: 'invalid-resource' }; }
    if (type === 'application/problem+json') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { contentState: 'unverified', reason: 'invalid-resource' };
      return { contentState: 'suspected-error', reason: 'soft-error' };
    }
    // A narrow error envelope, not a recursive search for words like "error".
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const value = data as Record<string, unknown>;
      const fields = Object.keys(value);
      const envelope = fields.length > 0 && fields.every(key => ['error','errors','message','code','status','success','ok'].includes(key));
      const error = (typeof value.error === 'string' && value.error.trim()) || value.error === true || (Array.isArray(value.errors) && value.errors.length > 0);
      if (envelope && error) return { contentState: 'suspected-error', reason: 'soft-error' };
    }
    return { contentState: 'present', reason: 'resource-found' };
  }
  if (type === 'text/plain') {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return { contentState: 'unverified', reason: 'invalid-resource' };
    const diagnostic = classifyContent({ title: '', heading: '', text, media: false, form: false, script: false, password: false });
    if (['suspected-error', 'challenge'].includes(diagnostic.contentState)) return diagnostic;
    return { contentState: 'present', reason: 'resource-found' };
  }
  return { contentState: 'unverified', reason: 'unsupported-content' };
}
