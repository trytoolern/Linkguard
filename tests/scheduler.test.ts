import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, runScheduled } from '../lib/scheduler.ts';
test('round robin balances origins without waiting for an entire batch', () => {
  const s = new Scheduler(['https://a.test/1', 'https://a.test/2', 'https://b.test/1'], 2, 1);
  assert.equal(s.acquire(), 0); assert.equal(s.acquire(), 2); assert.equal(s.acquire(), undefined);
  s.release(0); assert.equal(s.acquire(), 1); assert.throws(() => s.release(0));
});
test('random completions preserve quotas, unique dispatch and eventual drain', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (const n of [0, 1, 15, 100, 1000]) for (const global of [4, 8, 16, 32]) for (const perOrigin of [2, 4, 8]) {
    const s = new Scheduler(Array.from({ length: n }, (_, i) => `https://site${i % 7}.test/${i}`), global, perOrigin);
    const seen = new Set<number>(); let completed = 0;
    do {
      let id;
      while ((id = s.acquire()) !== undefined) { assert.ok(!seen.has(id)); seen.add(id); }
      assert.ok(s.active.size <= global); assert.ok(s.activeByOrigin.every(count => count >= 0 && count <= perOrigin));
      assert.equal(s.activeByOrigin.reduce((a, b) => a + b, 0), s.active.size);
      if (s.active.size) { s.release([...s.active][random() % s.active.size]!); completed++; }
    } while (s.active.size || completed < n);
    assert.equal(completed, n); assert.equal(seen.size, n);
  }
});
test('cancellation does not start queued work, waits for active work to settle', async () => {
  const controller = new AbortController(); let started = 0;
  const items = Array.from({ length: 15 }, (_, i) => ({ url: `https://a.test/${i}` }));
  await assert.rejects(runScheduled(items, async () => { started++; if (started === 1) controller.abort(); }, controller.signal, 4, 2));
  assert.equal(started, 1);
});
test('drains errors without unhandled rejections and handles an empty queue', async () => {
  await runScheduled([], async () => assert.fail(), new AbortController().signal);
  await assert.rejects(runScheduled([{ url: 'https://a.test' }], async () => { throw new Error('expected failure'); }, new AbortController().signal), /expected failure/);
});
