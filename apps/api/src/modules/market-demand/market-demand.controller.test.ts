import { describe, expect, it } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { MarketDemandController, parseWindowDays } from './market-demand.controller';

const req = {} as unknown as Request;

function makeStubs(authed = true) {
  const calls: Array<{ userId: string; windowDays: number }> = [];
  const trendCalls: string[] = [];
  const session = {
    requireUserId: () => {
      if (!authed) throw new UnauthorizedException('Not signed in');
      return 'user-1';
    },
  };
  const demand = {
    skillDemand: async (userId: string, windowDays: number) => {
      calls.push({ userId, windowDays });
      return { windowDays, rows: [] };
    },
    trendSignals: async (userId: string) => {
      trendCalls.push(userId);
      return { generatedAt: '2026-10-02T00:00:00.000Z', signals: [] };
    },
  };
  return {
    controller: new MarketDemandController(demand as never, session as never),
    calls,
    trendCalls,
  };
}

describe('parseWindowDays', () => {
  it('defaults to 30 when omitted/blank', () => {
    expect(parseWindowDays(undefined)).toBe(30);
    expect(parseWindowDays('')).toBe(30);
  });

  it('accepts a positive integer and clamps to [7, 365]', () => {
    expect(parseWindowDays('60')).toBe(60);
    expect(parseWindowDays('1')).toBe(7);
    expect(parseWindowDays('9999')).toBe(365);
  });

  it('rejects non-positive / non-integer input with 400', () => {
    for (const bad of ['0', '-5', 'abc', '2.5', 'NaN']) {
      expect(() => parseWindowDays(bad)).toThrow(BadRequestException);
    }
  });
});

describe('MarketDemandController', () => {
  it('401 on skill-demand when unauthenticated', async () => {
    const { controller } = makeStubs(false);
    await expect(controller.skillDemand(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 on trends when unauthenticated', async () => {
    const { controller } = makeStubs(false);
    await expect(controller.trends(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('delegates skill-demand with the parsed window for the authed user', async () => {
    const { controller, calls } = makeStubs();
    const out = await controller.skillDemand(req, '14');
    expect(calls).toEqual([{ userId: 'user-1', windowDays: 14 }]);
    expect(out).toEqual({ windowDays: 14, rows: [] });
  });

  it('defaults skill-demand window to 30 when the query is absent', async () => {
    const { controller, calls } = makeStubs();
    await controller.skillDemand(req, undefined);
    expect(calls).toEqual([{ userId: 'user-1', windowDays: 30 }]);
  });

  it('rejects a bad window before hitting the service', async () => {
    const { controller, calls } = makeStubs();
    await expect(controller.skillDemand(req, '-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  });

  it('delegates trends for the authed user', async () => {
    const { controller, trendCalls } = makeStubs();
    const out = await controller.trends(req);
    expect(out).toEqual({ generatedAt: '2026-10-02T00:00:00.000Z', signals: [] });
    expect(trendCalls).toEqual(['user-1']);
  });
});
