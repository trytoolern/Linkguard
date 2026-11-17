/** A work-conserving, round-robin queue. Limits concern original URL origins. */
export class OriginScheduler {
  readonly queues: number[][];
  readonly activeByOrigin: number[];
  readonly origins: number[];
  readonly active = new Set<number>();
  private cursor = 0;
  private heads: number[];
  readonly globalLimit: number;
  readonly originLimit: number;
  constructor(origins: readonly number[], globalLimit = 16, originLimit = 4) {
    this.globalLimit = globalLimit; this.originLimit = originLimit;
    if (![globalLimit, originLimit].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid concurrency limit');
    this.queues = []; this.origins = [];
    origins.forEach((group, i) => {
      if (!Number.isSafeInteger(group) || group < 0 || group > this.queues.length) throw new Error('Invalid origin index');
      if (group === this.queues.length) this.queues.push([]);
      this.queues[group]!.push(i); this.origins.push(group);
    });
    this.activeByOrigin = this.queues.map(() => 0); this.heads = this.queues.map(() => 0);
  }
  acquire(): number | undefined {
    if (this.active.size >= this.globalLimit) return;
    for (let offset = 0; offset < this.queues.length; offset++) {
      const group = (this.cursor + offset) % this.queues.length;
      if (this.activeByOrigin[group]! >= this.originLimit || this.heads[group]! >= this.queues[group]!.length) continue;
      const id = this.queues[group]![this.heads[group]!]!;
      this.heads[group]!++; this.activeByOrigin[group]!++; this.active.add(id);
      this.cursor = (group + 1) % this.queues.length;
      return id;
    }
  }
  release(id: number) {
    if (!this.active.delete(id)) throw new Error('Task is not active');
    this.activeByOrigin[this.origins[id]!]!--;
  }
}

export class Scheduler extends OriginScheduler {
  constructor(urls: readonly string[], globalLimit = 16, originLimit = 4) {
    const groups = new Map<string, number>();
    const origins = urls.map(url => {
      const origin = new URL(url).origin;
      if (!groups.has(origin)) groups.set(origin, groups.size);
      return groups.get(origin)!;
    });
    super(origins, globalLimit, originLimit);
  }
}

export async function runScheduled<T extends { url: string }>(items: readonly T[], task: (item: T) => Promise<void>, signal: AbortSignal, globalLimit = 16, originLimit = 4): Promise<void> {
  const scheduler = new Scheduler(items.map(item => item.url), globalLimit, originLimit);
  const inFlight = new Set<Promise<void>>();
  let failure: unknown;
  let failed = false;
  do {
    let id: number | undefined;
    while (!signal.aborted && !failed && (id = scheduler.acquire()) !== undefined) {
      const current = id;
      const job = Promise.resolve().then(() => { signal.throwIfAborted(); return task(items[current]!); })
        .catch(error => { failed = true; failure = error; })
        .finally(() => { scheduler.release(current); inFlight.delete(job); });
      inFlight.add(job);
    }
    if (inFlight.size) await Promise.race(inFlight);
  } while (inFlight.size);
  signal.throwIfAborted();
  if (failed) throw failure;
}
