/** Shared, cancellable, origin-fair pool. Queued work occupies no active slot. */
export class WorkPool {
  private pending: { origin: string; start(): void; cancel(): void }[] = [];
  private active = 0;
  private hosts = new Map<string, number>();
  private previous = '';
  readonly limit: number;
  readonly perOrigin: number;
  constructor(limit: number, perOrigin: number) {
    if (![limit, perOrigin].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid concurrency limit');
    this.limit = limit; this.perOrigin = perOrigin;
  }
  run<T>(url: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const origin = new URL(url).origin;
    return new Promise((resolve, reject) => {
      const entry = {
        origin,
        cancel: () => { this.pending = this.pending.filter(item => item !== entry); signal.removeEventListener('abort', entry.cancel); reject(signal.reason); this.drain(); },
        start: () => {
          signal.removeEventListener('abort', entry.cancel);
          this.active++; this.hosts.set(origin, (this.hosts.get(origin) ?? 0) + 1);
          void Promise.resolve().then(() => { signal.throwIfAborted(); return task(); }).then(resolve, reject).finally(() => {
            this.active--; const remaining = this.hosts.get(origin)! - 1;
            if (remaining) this.hosts.set(origin, remaining); else this.hosts.delete(origin);
            this.drain();
          });
        },
      };
      if (signal.aborted) { reject(signal.reason); return; }
      this.pending.push(entry); signal.addEventListener('abort', entry.cancel, { once: true }); this.drain();
    });
  }
  private drain() {
    while (this.active < this.limit) {
      const eligible = (entry: typeof this.pending[number]) => (this.hosts.get(entry.origin) ?? 0) < this.perOrigin;
      let index = this.pending.findIndex(entry => eligible(entry) && entry.origin !== this.previous);
      if (index < 0) index = this.pending.findIndex(eligible);
      if (index < 0) break;
      const [entry] = this.pending.splice(index, 1); this.previous = entry!.origin; entry!.start();
    }
  }
}
