import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { UsageController } from './usage.controller';

// A-M6 regression: prove the multi-user guard is actually wired at every
// mutating /me/* handler. If someone drops the `assertSingleUserForGlobalConfig`
// call, one of these three assertions fires.
describe('UsageController mutating /me/* endpoints (A-M6)', () => {
  const req = {} as never; // session.requireUserId is stubbed to bypass

  function makeController(userCount: number) {
    let guardCalls = 0;
    const setMonthlyLimitCalls: unknown[] = [];
    const setPausedCalls: unknown[] = [];
    const setCeilingCalls: unknown[] = [];
    const usage = {
      assertSingleUserForGlobalConfig: async () => {
        guardCalls++;
        if (userCount !== 1) throw new ForbiddenException('Multi-user config mutation not yet supported');
      },
      setMonthlyLimit: async (v: unknown) => {
        setMonthlyLimitCalls.push(v);
      },
      setPaused: async (v: unknown) => {
        setPausedCalls.push(v);
      },
    };
    const session = { requireUserId: () => 'user-1' };
    const sensitivity = {
      setProviderCeiling: async (name: string, ceiling: string) => {
        setCeilingCalls.push({ name, ceiling });
      },
      getPolicy: async () => ({}),
    };
    const controller = new UsageController(usage as never, session as never, sensitivity as never);
    return { controller, guardCalls: () => guardCalls, setMonthlyLimitCalls, setPausedCalls, setCeilingCalls };
  }

  it('POST /me/usage/budget succeeds when guard passes, mutates', async () => {
    const h = makeController(1);
    const out = await h.controller.setBudget({ monthlyLimitUsd: 25 }, req);
    expect(out).toEqual({ ok: true });
    expect(h.guardCalls()).toBe(1);
    expect(h.setMonthlyLimitCalls).toEqual([25]);
  });

  it('POST /me/usage/budget blocks with 403 when a second user exists', async () => {
    const h = makeController(2);
    await expect(h.controller.setBudget({ monthlyLimitUsd: 25 }, req)).rejects.toBeInstanceOf(ForbiddenException);
    // MUTATION-SMOKE: remove the `await this.usage.assertSingleUserForGlobalConfig()`
    // call from setBudget; the userCount=2 path stops throwing and the
    // setMonthlyLimit is called → this assertion fails.
    expect(h.setMonthlyLimitCalls).toEqual([]);
  });

  it('POST /me/usage/pause blocks with 403 when a second user exists', async () => {
    const h = makeController(2);
    await expect(h.controller.setPause({ paused: true }, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.setPausedCalls).toEqual([]);
  });

  it('POST /me/usage/sensitivity blocks with 403 when a second user exists', async () => {
    const h = makeController(2);
    await expect(
      h.controller.setSensitivity({ providerName: 'deepseek', ceiling: 'personal' }, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.setCeilingCalls).toEqual([]);
  });
});
