import { describe, expect, it } from 'vitest';
import { GLOBAL_CAP_PER_MIN, PER_TASK_CAP_PER_MIN, RateLimiter } from './pacing';

function fakeClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows requests up to the global cap in a rolling window', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    for (let i = 0; i < GLOBAL_CAP_PER_MIN; i++) {
      // Spread across different tasks so per-task cap isn't the limiter.
      expect(rl.acquire('linkedin.com', `t${i}`)).toEqual({ ok: true });
    }
    const blocked = rl.acquire('linkedin.com', 'tX');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.waitMs).toBeGreaterThan(0);
  });

  it('per-task cap trips before global cap when the same task hammers', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    for (let i = 0; i < PER_TASK_CAP_PER_MIN; i++) {
      expect(rl.acquire('linkedin.com', 'task-A')).toEqual({ ok: true });
    }
    const blocked = rl.acquire('linkedin.com', 'task-A');
    expect(blocked.ok).toBe(false);
  });

  it('slides the window: after 60s prior hits stop counting', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    for (let i = 0; i < GLOBAL_CAP_PER_MIN; i++) {
      rl.acquire('linkedin.com', `t${i}`);
    }
    expect(rl.acquire('linkedin.com', 'tX').ok).toBe(false);
    c.advance(60_001);
    expect(rl.acquire('linkedin.com', 'tX').ok).toBe(true);
  });

  it('separate domains do not interfere', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    for (let i = 0; i < GLOBAL_CAP_PER_MIN; i++) {
      rl.acquire('linkedin.com', `t${i}`);
    }
    expect(rl.acquire('indeed.com', 't-indeed').ok).toBe(true);
  });

  it('recordThrottle doubles backoff (1s -> 2s -> 4s), capped at 60s', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    expect(rl.recordThrottle('linkedin.com', 'task-A').waitMs).toBe(1_000);
    expect(rl.recordThrottle('linkedin.com', 'task-A').waitMs).toBe(2_000);
    expect(rl.recordThrottle('linkedin.com', 'task-A').waitMs).toBe(4_000);
    for (let i = 0; i < 10; i++) rl.recordThrottle('linkedin.com', 'task-A');
    expect(rl.recordThrottle('linkedin.com', 'task-A').waitMs).toBe(60_000);
  });

  it('backoff gates acquire until nextAllowedAt', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    const { waitMs } = rl.recordThrottle('linkedin.com', 'task-A');
    const blocked = rl.acquire('linkedin.com', 'task-A');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.waitMs).toBeLessThanOrEqual(waitMs);
    c.advance(waitMs);
    expect(rl.acquire('linkedin.com', 'task-A').ok).toBe(true);
  });

  it('recordSuccess clears backoff', () => {
    const c = fakeClock();
    const rl = new RateLimiter({ clock: c.now });
    rl.recordThrottle('linkedin.com', 'task-A');
    rl.recordSuccess('linkedin.com', 'task-A');
    expect(rl.acquire('linkedin.com', 'task-A').ok).toBe(true);
  });
});
