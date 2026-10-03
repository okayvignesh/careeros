import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CircuitBreaker,
  FallbackProvider,
  createProvider,
  type AIProvider,
  type Sensitivity,
} from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../modules/usage/usage.service';
import { UsageCache } from '../modules/usage/usage.cache';
import { SensitivityGateService } from './sensitivity-gate.service';
import { makeLlmAuditor } from './llm-audit';

const KEY = loadMasterKey();

export interface LoadedProvider {
  /**
   * Ordered primary → backup → local-Ollama wrapper. `name` is the configured
   * default; `activeProvider` reflects whichever candidate actually served the
   * latest call.
   */
  provider: AIProvider;
  model: string;
  /** Provider id of the configured default (candidates[0]). */
  providerName: string;
  /** Ordered provider ids actually usable for this call: primary → backups → ollama. */
  fallbackChain: string[];
  /**
   * True when the configured default is currently circuit-open, i.e. the next
   * call will degrade to a backup or local Ollama. Drives the "degraded" badge.
   */
  degraded: boolean;
}

type LoadFailure = 'no-config' | 'unsupported-provider' | 'no-secret';

interface ConfigRow {
  provider: string;
  chatModel: string;
  baseUrl: string | null;
  apiKeySecretId: string;
}

/**
 * Single source of truth for "budget → config rows → sensitivity gate →
 * decrypt secret → construct the adapter → wrap in a fallback chain".
 *
 * Adapter selection is driven by `ProviderConfig.provider`. The fallback order
 * is primary (the default row) → configured backups (other rows, newest first)
 * → local Ollama last-resort. Fallback is for *availability* only: the
 * sensitivity gate runs for every candidate, and a gate rejection of the
 * requested primary surfaces immediately rather than being routed around.
 * Circuit breaking is 5 consecutive availability failures → 60s open →
 * half-open probe (AGENTS.md); state is in-process, so a multi-replica
 * deployment would move it to Redis.
 */
@Injectable()
export class ProviderLoaderService {
  private readonly logger = new Logger(ProviderLoaderService.name);
  private readonly breaker = new CircuitBreaker(5, 60_000);
  /** userId → provider id that actually served the latest call (badge source). */
  private readonly lastServed = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  /** null for no-config / unsupported / missing-secret; throws on budget, gate, decrypt. */
  async loadProviderForUser(
    userId: string,
    sensitivity: Sensitivity,
  ): Promise<LoadedProvider | null> {
    const result = await this.resolve(userId, sensitivity);
    return typeof result === 'string' ? null : result;
  }

  /** resume.parse variant: throws NotFoundException for missing config/key. */
  async requireProviderForUser(userId: string, sensitivity: Sensitivity): Promise<LoadedProvider> {
    const result = await this.resolve(userId, sensitivity);
    if (result === 'no-secret') throw new NotFoundException('Provider key missing');
    if (typeof result === 'string') throw new NotFoundException('No AI provider configured');
    return result;
  }

  /**
   * Health view for the degraded badge. `degraded` is true when the default is
   * circuit-open or a fallback provider served the most recent call.
   */
  providerStatus(
    userId: string,
    providerName: string,
  ): {
    provider: string;
    activeProvider: string;
    degraded: boolean;
    open: boolean;
    failures: number;
    retryAt: number | null;
  } {
    const status = this.breaker.status(this.breakerKey(userId, providerName));
    const active = this.lastServed.get(userId) ?? providerName;
    return {
      provider: providerName,
      activeProvider: active,
      degraded: status.open || active !== providerName,
      open: status.open,
      failures: status.failures,
      retryAt: status.retryAt,
    };
  }

  private async resolve(
    userId: string,
    sensitivity: Sensitivity,
  ): Promise<LoadedProvider | LoadFailure> {
    await this.usage.assertCallAllowed(userId);
    const configs = (await this.prisma.providerConfig.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })) as ConfigRow[];
    if (configs.length === 0) return 'no-config';
    const primary = configs[0]!;

    // Authoritative egress decision for the requested provider. A policy block
    // must surface; it is never silently rerouted to a more permissive provider.
    await this.sensitivity.assertAllowed(primary.provider, sensitivity, userId);

    const primaryBuild = await this.buildPrimary(userId, primary);
    if (typeof primaryBuild === 'string') return primaryBuild;

    const candidates: AIProvider[] = [primaryBuild];
    const seen = new Set<string>([primary.provider]);
    for (const cfg of configs.slice(1)) {
      if (seen.has(cfg.provider)) continue;
      const built = await this.buildBackup(userId, cfg, sensitivity);
      if (built) {
        candidates.push(built);
        seen.add(cfg.provider);
      }
    }
    // Local Ollama last-resort, gated like any other provider.
    if (!seen.has('ollama') && (await this.gateAllows('ollama', sensitivity, userId))) {
      candidates.push(
        createProvider({
          provider: 'ollama',
          chatModel: 'llama3.1',
          onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
        }),
      );
    }

    const degraded = this.breaker.isOpen(this.breakerKey(userId, primary.provider));
    return {
      provider: new FallbackProvider(candidates, {
        keyPrefix: userId,
        breaker: this.breaker,
        onFallback: (info) => {
          this.lastServed.set(userId, info.activeProvider);
          this.logger.warn(
            { userId, primary: info.primaryProvider, active: info.activeProvider, reason: info.reason },
            'LLM provider fallback engaged',
          );
        },
      }),
      model: primary.chatModel,
      providerName: primary.provider,
      fallbackChain: candidates.map((candidate) => candidate.name),
      degraded,
    };
  }

  private async buildPrimary(
    userId: string,
    cfg: ConfigRow,
  ): Promise<AIProvider | 'no-secret' | 'unsupported-provider'> {
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: cfg.apiKeySecretId },
    });
    if (!secret) return 'no-secret';
    // Decrypt failures intentionally propagate: a corrupted key is a setup
    // error the user must see, not a reason to quietly route elsewhere.
    const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
    try {
      return this.construct(userId, cfg, apiKey);
    } catch (err) {
      this.logger.warn(
        { userId, provider: cfg.provider, err: (err as Error).message },
        'unsupported provider adapter',
      );
      return 'unsupported-provider';
    }
  }

  /** Backup candidates are best-effort: any failure turns into "skip". */
  private async buildBackup(
    userId: string,
    cfg: ConfigRow,
    sensitivity: Sensitivity,
  ): Promise<AIProvider | null> {
    if (!(await this.gateAllows(cfg.provider, sensitivity, userId))) return null;
    try {
      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
      return this.construct(userId, cfg, apiKey);
    } catch (err) {
      this.logger.warn(
        { userId, provider: cfg.provider, err: (err as Error).message },
        'backup provider skipped',
      );
      return null;
    }
  }

  private construct(userId: string, cfg: ConfigRow, apiKey: string): AIProvider {
    return createProvider({
      provider: cfg.provider,
      apiKey,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      chatModel: cfg.chatModel,
      onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
    });
  }

  private async gateAllows(
    providerName: string,
    sensitivity: Sensitivity,
    userId: string,
  ): Promise<boolean> {
    try {
      await this.sensitivity.assertAllowed(providerName, sensitivity, userId);
      return true;
    } catch {
      return false;
    }
  }

  private breakerKey(userId: string, providerName: string): string {
    return `${userId}:${providerName}`;
  }
}
