export type Outcome = 'ok' | 'broken' | 'restricted' | 'uncertain';
export type ScanMode = 'quick' | 'deep';
export type ScanScope = 'page' | 'site';
export interface Link { url: string; kind: 'internal' | 'external'; count: number }
export interface Result extends Link {
  status: number | null;
  outcome: Outcome;
  error: string;
  finalUrl: string;
  method: 'HEAD' | 'GET';
  elapsed: number;
  mode?: ScanMode;
  contentState?: ContentState;
  contentType?: string;
  reason?: ReasonCode;
  attempts?: number;
  bytes?: number;
  attachment?: boolean;
  browserAttempted?: boolean;
  browserChecked?: boolean;
  /** Original HTTP evidence, retained when browser navigation replaces status. */
  httpStatus?: number | null;
  httpReason?: ReasonCode;
  sources?: string[];
  depth?: number;
  /** Transient crawler data; never persisted in storage.session. */
  discoveredLinks?: string[];
  discoveryTruncated?: boolean;
}
export interface Scan {
  id: string;
  tabId: number;
  pageUrl: string;
  phase: 'scanning' | 'done' | 'cancelled' | 'interrupted' | 'error';
  total: number;
  skipped: number;
  truncated: boolean;
  results: Result[];
  started: number;
  message: string;
  highlighted: boolean;
  scope?: ScanScope;
  mode?: ScanMode;
  crawl?: { discovered: number; expanded: number; depth: number; limit: number };
  browserProgress?: { completed: number; total: number };
  renderingUrl?: string;
}
export type Filter = 'All' | 'Broken' | 'Unverified' | 'Internal' | 'External';
export type Message = {
  type: 'scan' | 'get' | 'cancel' | 'highlight' | 'render';
  tabId: number;
  url?: string;
  enabled?: boolean;
  mode?: ScanMode;
  scope?: ScanScope;
};
export type Reply = { scan?: Scan; error?: string };
export type ContentState = 'not-checked' | 'present' | 'empty' | 'needs-browser' | 'suspected-error' | 'challenge' | 'login' | 'unverified';
export type ReasonCode = 'crawl-skipped' | 'http' | 'content-found' | 'soft-error' | 'challenge' | 'login' | 'form-unverified' | 'media-unverified' | 'needs-browser' | 'insufficient-content' | 'empty-content' | 'size-limit' | 'unsupported-content' | 'encoding' | 'incomplete' | 'timeout' | 'network' | 'server-error' | 'resource-found' | 'invalid-resource' | 'resource-limit';
