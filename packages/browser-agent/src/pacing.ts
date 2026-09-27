/**
 * Rate limiter for browser-agent Playwright actions.
 *
 * Two caps enforced in parallel (whichever is stricter wins):
 *   - Global: 6 requests / minute per domain
 *   - Per-task: 3 requests / minute
 *
 * Sliding window over the last 60_000 ms of accepted timestamps. Backoff on
 * 429/503 doubles from 1s up to 60s per (domain,task) key. Clock is
 * injectable so tests skip real waits.
 *
 * ponytail: in-memory only, single-process. If we ever run multiple agent
 * instances against the same account we need Redis-backed counters; today
 * one user = one machine = one process, so YAGNI.
 */

export const GLOBAL_CAP_PER_MIN = 6;
export const PER_TASK_CAP_PER_MIN = 3;
const WINDOW_MS = 60_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export type Clock = () => number;

export interface RateLimiterOptions {
  clock?: Clock;
  globalCap?: number;
  perTaskCap?: number;
  windowMs?: number;
}

interface BackoffState {
  attempts: number;
  nextAllowedAt: number;
}

export class RateLimiter {
  private readonly clock: Clock;
  private readonly globalCap: number;
  private readonly perTaskCap: number;
  private readonly windowMs: number;
  private readonly globalHits = new Map<string, number[]>();
  private readonly taskHits = new Map<string, number[]>();
  private readonly backoff = new Map<string, BackoffState>();

  constructor(opts: RateLimiterOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    this.globalCap = opts.globalCap ?? GLOBAL_CAP_PER_MIN;
    this.perTaskCap = opts.perTaskCap ?? PER_TASK_CAP_PER_MIN;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
  }

  /**
   * Ask permission to make a request.
   * Returns `{ ok: true }` if allowed (and records the hit), or
   * `{ ok: false, waitMs }` if the caller must wait before retrying.
   */
  acquire(domain: string, taskId: string): { ok: true } | { ok: false; waitMs: number } {
    const now = this.clock();

    // Backoff window from prior 429/503 gates everything else.
    const bo = this.backoff.get(this.backoffKey(domain, taskId));
    if (bo && now < bo.nextAllowedAt) {
      return { ok: false, waitMs: bo.nextAllowedAt - now };
    }

    const globalHits = this.prune(this.globalHits, domain, now);
    if (globalHits.length >= this.globalCap) {
      const oldest = globalHits[0]!;
      return { ok: false, waitMs: this.windowMs - (now - oldest) };
    }

    const taskHits = this.prune(this.taskHits, taskId, now);
    if (taskHits.length >= this.perTaskCap) {
      const oldest = taskHits[0]!;
      return { ok: false, waitMs: this.windowMs - (now - oldest) };
    }

    globalHits.push(now);
    taskHits.push(now);
    return { ok: true };
  }

  /**
   * Record a rate-limit response from the server; doubles the backoff for
   * (domain,task). Call *before* the next `acquire`.
   */
  recordThrottle(domain: string, taskId: string): { waitMs: number } {
    const key = this.backoffKey(domain, taskId);
    const prev = this.backoff.get(key);
    const attempts = (prev?.attempts ?? 0) + 1;
    const waitMs = Math.min(
      BACKOFF_START_MS * 2 ** (attempts - 1),
      BACKOFF_MAX_MS,
    );
    this.backoff.set(key, { attempts, nextAllowedAt: this.clock() + waitMs });
    return { waitMs };
  }

  /** Clear backoff on a successful response. */
  recordSuccess(domain: string, taskId: string): void {
    this.backoff.delete(this.backoffKey(domain, taskId));
  }

  private prune(map: Map<string, number[]>, key: string, now: number): number[] {
    const arr = map.get(key) ?? [];
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < arr.length && arr[i]! <= cutoff) i++;
    const pruned = i === 0 ? arr : arr.slice(i);
    map.set(key, pruned);
    return pruned;
  }

  private backoffKey(domain: string, taskId: string): string {
    return `${domain}::${taskId}`;
  }
}
