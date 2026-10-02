import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeepSeekProvider, type Sensitivity } from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../modules/usage/usage.service';
import { UsageCache } from '../modules/usage/usage.cache';
import { SensitivityGateService } from './sensitivity-gate.service';
import { makeLlmAuditor } from './llm-audit';

const KEY = loadMasterKey();

export interface LoadedProvider {
  provider: DeepSeekProvider;
  model: string;
}

type LoadFailure = 'no-config' | 'unsupported-provider' | 'no-secret';

/**
 * Single source of truth for "budget → default provider config → sensitivity
 * gate → decrypt secret → construct DeepSeekProvider". Callers previously
 * carried seven near-identical copies differing only by sensitivity level and
 * error handling; this is the extracted helper they now share.
 *
 * `loadProviderForUser` returns null for the expected "nothing to load" cases
 * (no config, non-deepseek config, missing key) and throws for budget, gate,
 * and decrypt failures — exactly the split each caller's try/catch expects.
 * `requireProviderForUser` is the resume-ingest variant: it throws 404s for the
 * missing cases and, preserving that path's legacy behaviour, does not reject a
 * non-deepseek config before constructing the client.
 */
@Injectable()
export class ProviderLoaderService {
  private readonly logger = new Logger(ProviderLoaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  /** null for no-config / non-deepseek / missing-secret; throws on budget, gate, decrypt. */
  async loadProviderForUser(
    userId: string,
    sensitivity: Sensitivity,
  ): Promise<LoadedProvider | null> {
    const result = await this.resolve(userId, sensitivity, true);
    return typeof result === 'string' ? null : result;
  }

  /** resume.parse variant: throws NotFoundException for missing config/key. */
  async requireProviderForUser(userId: string, sensitivity: Sensitivity): Promise<LoadedProvider> {
    const result = await this.resolve(userId, sensitivity, false);
    if (result === 'no-config') throw new NotFoundException('No AI provider configured');
    if (result === 'no-secret') throw new NotFoundException('Provider key missing');
    if (typeof result === 'string') throw new NotFoundException('No AI provider configured');
    return result;
  }

  private async resolve(
    userId: string,
    sensitivity: Sensitivity,
    requireDeepSeek: boolean,
  ): Promise<LoadedProvider | LoadFailure> {
    await this.usage.assertCallAllowed(userId);
    const cfg = await this.prisma.providerConfig.findFirst({
      where: { userId, isDefault: true },
    });
    if (!cfg) return 'no-config';
    if (requireDeepSeek && cfg.provider !== 'deepseek') return 'unsupported-provider';
    await this.sensitivity.assertAllowed(cfg.provider, sensitivity, userId);
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: cfg.apiKeySecretId },
    });
    if (!secret) return 'no-secret';
    const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
    return {
      provider: new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      }),
      model: cfg.chatModel,
    };
  }
}
