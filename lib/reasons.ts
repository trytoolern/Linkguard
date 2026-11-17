import type { ContentState, ReasonCode } from './types.ts';
export const reasonMessages: Record<ReasonCode, string> = {
  'crawl-skipped': 'Blocked by crawl rules',
  'resource-found': 'Resource content found', 'invalid-resource': 'Invalid resource content', 'resource-limit': 'Resource size limit exceeded',
  http: '', 'content-found': 'Content found', 'soft-error': 'Possible error page', challenge: 'Access denied', login: 'Authentication required',
  'form-unverified': 'Media or form needs verification', 'media-unverified': 'Media or form needs verification',
  'needs-browser': 'Needs browser check', 'insufficient-content': 'Content unavailable', 'empty-content': 'Content unavailable',
  'size-limit': 'HTML limit exceeded', 'unsupported-content': 'Unsupported content', encoding: 'Unsupported content',
  incomplete: 'Incomplete content', timeout: 'Timeout', network: 'Network / TLS / blocked', 'server-error': 'Server error',
};
export const contentMessages: Record<ContentState, string> = {
  'not-checked': 'Not scanned', present: 'Content found', empty: 'Content unavailable', 'needs-browser': 'Needs browser check',
  'suspected-error': 'Possible error page', challenge: 'Access denied', login: 'Authentication required', unverified: 'Unverified',
};
