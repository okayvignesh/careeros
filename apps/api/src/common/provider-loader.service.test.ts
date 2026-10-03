import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ProviderLoaderService } from './provider-loader.service';
import { encrypt, loadMasterKey } from '@careeros/secrets';

const KEY = loadMasterKey();

interface Cfg {
  id: string;
  userId: string;
  provider: string;
  isDefault: boolean;
  chatModel: string;
  baseUrl: string | null;
  apiKeySecretId: string;
  createdAt: Date;
}

function cfg(overrides: Partial<Cfg> = {}): Cfg {
  return {
    id: 'cfg-1',
    userId: 'u1',
    provider: 'deepseek',
    isDefault: true,
    chatModel: 'deepseek-chat',
    baseUrl: null,
    apiKeySecretId: 'sec-1',
    createdAt: new Date(0),
    ...overrides,
  };
}

function secret(provider: string): { ciphertext: string } {
  return { ciphertext: encrypt('sk-test', KEY, `provider:${provider}:apiKey`) };
}

function build(
  opts: {
    configs?: Cfg[];
    secrets?: Record<string, { ciphertext: string } | null>;
    gateRejects?: string[];
  } = {},
) {
  const configs = opts.configs ?? [cfg()];
  const secrets: Record<string, { ciphertext: string } | null> = opts.secrets ?? {
    'sec-1': secret('deepseek'),
  };
  const gateRejects = new Set(opts.gateRejects ?? []);
  const usage = { assertCallAllowed: vi.fn(async () => {}) };
  const sensitivity = {
    assertAllowed: vi.fn(async (provider: string) => {
      if (gateRejects.has(provider)) throw new Error('ceiling too low');
    }),
  };
  const svc = new ProviderLoaderService(
    {
      providerConfig: { findMany: async () => configs },
      encryptedSecret: {
        findUnique: async ({ where }: { where: { id: string } }) => secrets[where.id] ?? null,
      },
      llmCall: { create: async () => ({}) },
    } as never,
    usage as never,
    {} as never,
    sensitivity as never,
  );
  return { svc, usage, sensitivity };
}

describe('ProviderLoaderService.loadProviderForUser — adapter selection', () => {
  it('returns null when no provider config exists', async () => {
    const { svc } = build({ configs: [] });
    await expect(svc.loadProviderForUser('u1', 'public')).resolves.toBeNull();
  });

  it('selects the DeepSeek adapter and appends local Ollama last-resort', async () => {
    const { svc } = build();
    const loaded = await svc.loadProviderForUser('u1', 'public');
    expect(loaded).not.toBeNull();
    expect(loaded!.provider.name).toBe('deepseek');
    expect(loaded!.providerName).toBe('deepseek');
    expect(loaded!.model).toBe('deepseek-chat');
    expect(loaded!.fallbackChain).toEqual(['deepseek', 'ollama']);
    expect(loaded!.degraded).toBe(false);
  });

  it('selects the OpenAI-compatible adapter from ProviderConfig.provider', async () => {
    const { svc } = build({
      configs: [cfg({ provider: 'openai', chatModel: 'gpt-4o-mini', apiKeySecretId: 'sec-o' })],
      secrets: { 'sec-o': secret('openai') },
    });
    const loaded = await svc.loadProviderForUser('u1', 'public');
    expect(loaded!.provider.name).toBe('openai');
    expect(loaded!.provider.capabilities.contextWindow).toBe(128_000);
  });

  it('keeps an ollama-only configuration with no duplicate last-resort', async () => {
    const { svc } = build({
      configs: [cfg({ provider: 'ollama', chatModel: 'llama3.1', apiKeySecretId: 'sec-oll' })],
      secrets: { 'sec-oll': secret('ollama') },
    });
    const loaded = await svc.loadProviderForUser('u1', 'public');
    expect(loaded!.fallbackChain).toEqual(['ollama']);
  });

  it('builds the fallback order primary → backup → local Ollama', async () => {
    const { svc } = build({
      configs: [
        cfg({ id: 'cfg-1', provider: 'deepseek', apiKeySecretId: 'sec-d' }),
        cfg({
          id: 'cfg-2',
          provider: 'openai',
          isDefault: false,
          chatModel: 'gpt-4o-mini',
          apiKeySecretId: 'sec-o',
          createdAt: new Date(1),
        }),
      ],
      secrets: { 'sec-d': secret('deepseek'), 'sec-o': secret('openai') },
    });
    const loaded = await svc.loadProviderForUser('u1', 'public');
    expect(loaded!.fallbackChain).toEqual(['deepseek', 'openai', 'ollama']);
  });

  it('drops a backup the sensitivity gate rejects', async () => {
    const { svc } = build({
      configs: [
        cfg({ id: 'cfg-1', provider: 'deepseek', apiKeySecretId: 'sec-d' }),
        cfg({ id: 'cfg-2', provider: 'openai', isDefault: false, apiKeySecretId: 'sec-o' }),
      ],
      secrets: { 'sec-d': secret('deepseek'), 'sec-o': secret('openai') },
      gateRejects: ['openai'],
    });
    const loaded = await svc.loadProviderForUser('u1', 'public');
    expect(loaded!.fallbackChain).toEqual(['deepseek', 'ollama']);
  });

  it('reports degraded=false until a fallback actually serves', async () => {
    const { svc } = build();
    await svc.loadProviderForUser('u1', 'public');
    expect(svc.providerStatus('u1', 'deepseek')).toMatchObject({
      degraded: false,
      activeProvider: 'deepseek',
      open: false,
    });
  });

  it('returns null when the primary api key secret is missing', async () => {
    const { svc } = build({ secrets: { 'sec-1': null } });
    await expect(svc.loadProviderForUser('u1', 'public')).resolves.toBeNull();
  });

  it('propagates budget failures instead of swallowing them', async () => {
    const { svc, usage } = build();
    usage.assertCallAllowed.mockRejectedValueOnce(new Error('paused'));
    await expect(svc.loadProviderForUser('u1', 'public')).rejects.toThrow('paused');
  });

  it('propagates a sensitivity-gate rejection of the requested primary', async () => {
    const { svc, sensitivity } = build();
    sensitivity.assertAllowed.mockRejectedValueOnce(new Error('ceiling too low'));
    await expect(svc.loadProviderForUser('u1', 'personal')).rejects.toThrow('ceiling too low');
  });
});

describe('ProviderLoaderService.requireProviderForUser', () => {
  it('throws 404 "No AI provider configured" when config is absent', async () => {
    const { svc } = build({ configs: [] });
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toThrow(
      'No AI provider configured',
    );
  });

  it('throws 404 "Provider key missing" when the secret is absent', async () => {
    const { svc } = build({ secrets: { 'sec-1': null } });
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toThrow('Provider key missing');
  });
});
