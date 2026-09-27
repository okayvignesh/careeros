import pLimit from 'p-limit';

/**
 * N=2 concurrent sandbox runs by default. Larger N means more docker daemon churn and
 * more parallel image-pull contention on first run; the spec asks for 2 and that's
 * what fits a single-user box.
 *
 * ponytail: process-local limiter — if the api ever scales to multiple replicas, move
 * this to a redis-backed semaphore. YAGNI at N=1 replica.
 */
export const DEFAULT_CONCURRENCY = 2;

let limiter = pLimit(DEFAULT_CONCURRENCY);
let currentConcurrency = DEFAULT_CONCURRENCY;

export function withPool<T>(fn: () => Promise<T>): Promise<T> {
  return limiter(fn);
}

export function getPoolConcurrency(): number {
  return currentConcurrency;
}

/** For tests + operator overrides at boot. Not safe mid-flight. */
export function setPoolConcurrency(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new Error(`pool concurrency must be a positive integer, got ${n}`);
  limiter = pLimit(n);
  currentConcurrency = n;
}
