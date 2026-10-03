import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SearchProvidersController } from './search-providers.controller';

const req = {} as unknown as Request;

function makeStubs(authed = true) {
  const calls: string[] = [];
  const session = {
    requireUserId: () => {
      if (!authed) throw new UnauthorizedException('Not signed in');
      return 'user-1';
    },
  };
  const service = {
    list: async () => {
      calls.push('list');
      return { providers: [] };
    },
    workloads: async () => {
      calls.push('workloads');
      return { workloads: [] };
    },
  };
  return { controller: new SearchProvidersController(service as never, session as never), calls };
}

describe('SearchProvidersController', () => {
  it('401 on GET / when unauthenticated', async () => {
    const { controller } = makeStubs(false);
    await expect(controller.list(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 on GET /workloads when unauthenticated', async () => {
    const { controller } = makeStubs(false);
    await expect(controller.workloads(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('delegates both authed routes', async () => {
    const { controller, calls } = makeStubs();
    await expect(controller.list(req)).resolves.toEqual({ providers: [] });
    await expect(controller.workloads(req)).resolves.toEqual({ workloads: [] });
    expect(calls).toEqual(['list', 'workloads']);
  });
});
