import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  allowedProviders,
  decideProviderEgress,
  type ProviderPolicy,
  type Sensitivity,
} from '@careeros/ai';
import { SensitivityGateService } from './sensitivity-gate.service';

// A6 regression suite: SensitivityGateService is the ONE policy source and the
// ONE egress decision point. It must agree exactly with the pure primitive.

function build(stored: ProviderPolicy | null = null) {
  let value = stored;
  const prisma = {
    appConfig: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        value ? { key: where.key, value } : null,
      upsert: async ({
        create,
        update,
      }: {
        create: { value: ProviderPolicy };
        update: { value: ProviderPolicy };
      }) => {
        value = update.value ?? create.value;
        return {};
      },
    },
  };
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  const svc = new SensitivityGateService(prisma as never, logger as never);
  return { svc, logger, stored: () => value };
}

async function isAllowed(
  svc: SensitivityGateService,
  provider: string,
  sensitivity: Sensitivity,
): Promise<boolean> {
  try {
    await svc.assertAllowed(provider, sensitivity, 'user-1');
    return true;
  } catch (err) {
    if (err instanceof ServiceUnavailableException) return false;
    throw err;
  }
}

describe('SensitivityGateService default policy', () => {
  it('employer-confidential stays local-only by default', async () => {
    const { svc } = build();
    // External providers cap at personal.
    expect(await isAllowed(svc, 'deepseek', 'employer-confidential')).toBe(false);
    expect(await isAllowed(svc, 'openai', 'employer-confidential')).toBe(false);
    // Local providers cap at confidential, so even they refuse employer-confidential.
    expect(await isAllowed(svc, 'ollama', 'employer-confidential')).toBe(false);
    expect(await isAllowed(svc, 'local', 'employer-confidential')).toBe(false);
  });

  it('allows personal to external and confidential to local', async () => {
    const { svc } = build();
    expect(await isAllowed(svc, 'deepseek', 'personal')).toBe(true);
    expect(await isAllowed(svc, 'deepseek', 'public')).toBe(true);
    expect(await isAllowed(svc, 'ollama', 'confidential')).toBe(true);
    expect(await isAllowed(svc, 'deepseek', 'confidential')).toBe(false);
  });

  it('unknown providers fail closed', async () => {
    const { svc } = build();
    expect(await isAllowed(svc, 'no-such-provider', 'public')).toBe(false);
  });

  it('distinguishes not-permitted from above-ceiling in the 503 message', async () => {
    const { svc } = build({ deepseek: 'personal', killswitch: 'block' });
    await expect(svc.assertAllowed('killswitch', 'public')).rejects.toThrow(
      /is not permitted/,
    );
    await expect(svc.assertAllowed('deepseek', 'employer-confidential')).rejects.toThrow(
      /Cannot send 'employer-confidential' data/,
    );
  });
});

describe('SensitivityGateService policy is the single source of truth', () => {
  it('stored AppConfig overrides the default and is honoured', async () => {
    const { svc, stored } = build({ deepseek: 'confidential' });
    expect(await isAllowed(svc, 'deepseek', 'confidential')).toBe(true);
    expect(await isAllowed(svc, 'deepseek', 'employer-confidential')).toBe(false);
    expect(stored()).toEqual({ deepseek: 'confidential' });
  });

  it('setProviderCeiling persists a merged policy', async () => {
    const { svc } = build();
    await svc.setProviderCeiling('deepseek', 'confidential');
    const policy = await svc.getPolicy();
    expect(policy.deepseek).toBe('confidential');
    // Defaults for other providers survive the merge.
    expect(policy.ollama).toBe('confidential');
  });

  it('same decision through either path: service === decideProviderEgress', async () => {
    const { svc } = build({ deepseek: 'confidential' });
    const policy = await svc.getPolicy();
    const providers = [...Object.keys(policy), 'ghost-provider'];
    const levels: Sensitivity[] = ['public', 'personal', 'confidential', 'employer-confidential'];
    for (const provider of providers) {
      for (const level of levels) {
        const expected = decideProviderEgress(provider, level, policy).allowed;
        expect(await isAllowed(svc, provider, level)).toBe(expected);
      }
    }
  });

  it('mixed-sensitivity payload blocks the correct provider', async () => {
    const { svc } = build();
    const policy = await svc.getPolicy();
    // A payload that includes employer-confidential code may only route locally
    // (and by default not even there) — never to an external provider.
    const forCode = allowedProviders('employer-confidential', policy);
    expect(forCode).not.toContain('deepseek');
    expect(forCode).not.toContain('openai');
    // The same payload's public portions are fine for external providers.
    expect(allowedProviders('public', policy)).toContain('deepseek');
    expect(await isAllowed(svc, 'deepseek', 'employer-confidential')).toBe(false);
    expect(await isAllowed(svc, 'deepseek', 'public')).toBe(true);
  });
});
