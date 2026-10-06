import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SearchProvidersController } from './search-providers.controller';

const req = {} as unknown as Request;

function makeStubs(authed = true) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const session = {
    requireUserId: () => {
      if (!authed) throw new UnauthorizedException('Not signed in');
      return 'user-1';
    },
  };
  const service = {
    list: async () => {
      calls.push({ method: 'list', args: [] });
      return { providers: [] };
    },
    workloads: async () => {
      calls.push({ method: 'workloads', args: [] });
      return { workloads: [] };
    },
    save: async (...args: unknown[]) => {
      calls.push({ method: 'save', args });
      return { id: 'firecrawl', name: 'Firecrawl' };
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

  it('401 on PUT /:id when unauthenticated', async () => {
    const { controller } = makeStubs(false);
    await expect(controller.save('firecrawl', { values: {} }, req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('delegates both authed GET routes', async () => {
    const { controller, calls } = makeStubs();
    await expect(controller.list(req)).resolves.toEqual({ providers: [] });
    await expect(controller.workloads(req)).resolves.toEqual({ workloads: [] });
    expect(calls.map((c) => c.method)).toEqual(['list', 'workloads']);
  });

  it('delegates PUT with the provider id and body', async () => {
    const { controller, calls } = makeStubs();
    const body = { values: { apiKey: 'new-key' } };
    await expect(controller.save('firecrawl', body, req)).resolves.toEqual({
      id: 'firecrawl',
      name: 'Firecrawl',
    });
    expect(calls.find((c) => c.method === 'save')!.args).toEqual(['firecrawl', body]);
  });
});
