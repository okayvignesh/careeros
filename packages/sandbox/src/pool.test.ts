import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, getPoolConcurrency, setPoolConcurrency, withPool } from './pool';

describe('pool (p-limit backed)', () => {
  afterEach(() => setPoolConcurrency(DEFAULT_CONCURRENCY));

  it('DEFAULT_CONCURRENCY is 2 (spec)', () => {
    expect(DEFAULT_CONCURRENCY).toBe(2);
    expect(getPoolConcurrency()).toBe(2);
  });

  it('at most 2 tasks execute concurrently', async () => {
    let active = 0;
    let peak = 0;
    const task = () =>
      withPool(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return active;
      });
    // Fire 6 concurrently; if the limiter didn't apply, peak would be 6.
    await Promise.all([task(), task(), task(), task(), task(), task()]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('tasks are queued in FIFO order (p-limit contract)', async () => {
    const started: number[] = [];
    const gate: Array<() => void> = [];
    // First 2 seats occupied; the next 4 must line up.
    const holders = [0, 1].map((i) =>
      withPool(async () => {
        started.push(i);
        await new Promise<void>((r) => gate.push(r));
      }),
    );
    // Give the limiter a tick to seat the first two.
    await new Promise((r) => setTimeout(r, 5));
    const queued = [2, 3, 4, 5].map((i) =>
      withPool(async () => {
        started.push(i);
      }),
    );
    // Release seats one by one; queue drains in submission order.
    gate.forEach((r) => r());
    await Promise.all([...holders, ...queued]);
    // Order: 0 and 1 seated first (in some daemon order), then 2,3,4,5.
    expect(started.slice(0, 2).sort()).toEqual([0, 1]);
    expect(started.slice(2)).toEqual([2, 3, 4, 5]);
  });

  it('errors in the task propagate and free the seat', async () => {
    await expect(withPool(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // Seat should be free — next task runs fine.
    const ok = await withPool(() => Promise.resolve(42));
    expect(ok).toBe(42);
  });

  it('setPoolConcurrency validates and rebuilds the limiter', () => {
    setPoolConcurrency(4);
    expect(getPoolConcurrency()).toBe(4);
    expect(() => setPoolConcurrency(0)).toThrow(/positive integer/);
    expect(() => setPoolConcurrency(-1)).toThrow(/positive integer/);
    expect(() => setPoolConcurrency(1.5)).toThrow(/positive integer/);
  });
});
