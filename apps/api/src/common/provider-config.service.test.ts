import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ProviderConfigShape } from '@careeros/shared';
import { decryptField, loadMasterKey } from '@careeros/secrets';
import { ProviderConfigService, PROVIDER_CONFIG_KEY_PREFIX } from './provider-config.service';

function makePrisma() {
  const store = new Map<string, unknown>();
  return {
    store,
    prisma: {
      appConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null,
        findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in.filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k) })),
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: { value: unknown };
          update: { value: unknown };
        }) => {
          store.set(where.key, store.has(where.key) ? update.value : create.value);
          return { key: where.key };
        },
      },
    },
  };
}

function service() {
  const { prisma, store } = makePrisma();
  return { svc: new ProviderConfigService(prisma as never), store };
}

describe('ProviderConfigService.save / view', () => {
  it('seals secret fields at rest and never exposes them in the view', async () => {
    const { svc, store } = service();
    const view = await svc.save('firecrawl', { values: { apiKey: 'fc-secret' } });

    const row = store.get(`${PROVIDER_CONFIG_KEY_PREFIX}firecrawl`) as ProviderConfigShape;
    const sealed = row.secrets['apiKey']!;
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('fc-secret');
    expect(decryptField(sealed, loadMasterKey(), 'provider.firecrawl.apiKey')).toBe('fc-secret');

    expect(view.has).toEqual({ apiKey: true });
    expect(view.values).toEqual({});
    expect(JSON.stringify(view)).not.toContain('fc-secret');
    expect(view.configured).toBe(true);
    expect(view.missing).toEqual([]);
  });

  it('round-trips the sealed secret through resolve (internal only)', async () => {
    const { svc } = service();
    await svc.save('firecrawl', { values: { apiKey: 'fc-secret' } });
    const creds = await svc.resolve('firecrawl');
    expect(creds.secrets).toEqual({ apiKey: 'fc-secret' });
  });

  it('keeps a stored secret when the new value is blank', async () => {
    const { svc } = service();
    await svc.save('firecrawl', { values: { apiKey: 'fc-original' } });
    await svc.save('firecrawl', { values: { apiKey: '   ' } });
    const creds = await svc.resolve('firecrawl');
    expect(creds.secrets['apiKey']).toBe('fc-original');
  });
});

describe('ProviderConfigService required/missing', () => {
  it('computes missing from the DB config and flips configured when complete', async () => {
    const { svc } = service();
    const partial = await svc.save('adzuna', { values: { appId: 'app-1' } });
    expect(partial.configured).toBe(false);
    expect(partial.missing).toEqual(['appKey']);

    const complete = await svc.save('adzuna', { values: { appId: 'app-1', appKey: 'key-1' } });
    expect(complete.configured).toBe(true);
    expect(complete.missing).toEqual([]);
  });

  it('falls back to env for presence only when the DB has no value', async () => {
    const { svc } = service();
    const view = await svc.view('firecrawl', { FIRECRAWL_API_KEY: 'env-key' });
    expect(view.configured).toBe(true);
    expect(view.has).toEqual({ apiKey: true });
    expect(view.values).toEqual({});
  });
});

describe('ProviderConfigService validation', () => {
  it('rejects an unknown provider', async () => {
    const { svc } = service();
    await expect(svc.save('nope', { values: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown field for a known provider', async () => {
    const { svc } = service();
    await expect(svc.save('firecrawl', { values: { bogus: 'x' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
