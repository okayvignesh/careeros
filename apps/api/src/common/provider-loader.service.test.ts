import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DeepSeekProvider } from '@careeros/ai';
import { encrypt, loadMasterKey } from '@careeros/secrets';
import { ProviderLoaderService } from './provider-loader.service';

const KEY = loadMasterKey();

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    userId: 'u1',
    provider: 'deepseek',
    isDefault: true,
    chatModel: 'deepseek-chat',
    baseUrl: null,
    apiKeySecretId: 'sec-1',
    ...overrides,
  };
}

function build(opts: {
  cfg?: Record<string, unknown> | null;
  secret?: { ciphertext: string } | null;
} = {}) {
  const cfg = opts.cfg === undefined ? config() : opts.cfg;
  const secret =
    opts.secret === undefined
      ? { ciphertext: encrypt('sk-test', KEY, 'provider:deepseek:apiKey') }
      : opts.secret;
  const usage = { assertCallAllowed: vi.fn(async () => {}) };
  const sensitivity = { assertAllowed: vi.fn(async () => {}) };
  const svc = new ProviderLoaderService(
    {
      providerConfig: { findFirst: async () => cfg },
      encryptedSecret: { findUnique: async () => secret },
      llmCall: { create: async () => ({}) },
    } as never,
    usage as never,
    {} as never,
    sensitivity as never,
  );
  return { svc, usage, sensitivity };
}

describe('ProviderLoaderService.loadProviderForUser', () => {
  it('returns null when no default provider config exists', async () => {
    const { svc } = build({ cfg: null });
    await expect(svc.loadProviderForUser('u1', 'public')).resolves.toBeNull();
  });

  it('returns null for a non-deepseek config', async () => {
    const { svc } = build({ cfg: config({ provider: 'openai' }) });
    await expect(svc.loadProviderForUser('u1', 'public')).resolves.toBeNull();
  });

  it('returns null when the api key secret is missing', async () => {
    const { svc } = build({ secret: null });
    await expect(svc.loadProviderForUser('u1', 'public')).resolves.toBeNull();
  });

  it('propagates budget failures instead of swallowing them', async () => {
    const { svc, usage } = build();
    usage.assertCallAllowed.mockRejectedValueOnce(new Error('paused'));
    await expect(svc.loadProviderForUser('u1', 'public')).rejects.toThrow('paused');
  });

  it('propagates sensitivity-gate failures', async () => {
    const { svc, sensitivity } = build();
    sensitivity.assertAllowed.mockRejectedValueOnce(new Error('ceiling too low'));
    await expect(svc.loadProviderForUser('u1', 'personal')).rejects.toThrow('ceiling too low');
  });

  it('returns a constructed DeepSeekProvider + model on success', async () => {
    const { svc } = build();
    const loaded = await svc.loadProviderForUser('u1', 'personal');
    expect(loaded).not.toBeNull();
    expect(loaded!.provider).toBeInstanceOf(DeepSeekProvider);
    expect(loaded!.model).toBe('deepseek-chat');
  });
});

describe('ProviderLoaderService.requireProviderForUser', () => {
  it('throws 404 "No AI provider configured" when config is absent', async () => {
    const { svc } = build({ cfg: null });
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toThrow(
      'No AI provider configured',
    );
  });

  it('throws 404 "Provider key missing" when the secret is absent', async () => {
    const { svc } = build({ secret: null });
    await expect(svc.requireProviderForUser('u1', 'personal')).rejects.toThrow('Provider key missing');
  });

  it('legacy resume path: allows a non-deepseek config through to construction', async () => {
    const { svc } = build({
      cfg: config({ provider: 'openai' }),
      secret: { ciphertext: encrypt('sk-test', KEY, 'provider:openai:apiKey') },
    });
    const loaded = await svc.requireProviderForUser('u1', 'personal');
    expect(loaded.provider).toBeInstanceOf(DeepSeekProvider);
  });
});
