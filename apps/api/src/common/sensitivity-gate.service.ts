import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  SENSITIVITY_LEVELS,
  decideProviderEgress,
  type ProviderCeiling,
  type ProviderPolicy,
  type Sensitivity,
} from '@careeros/ai';
import { PrismaService } from '../prisma/prisma.service';

export type { ProviderCeiling } from '@careeros/ai';

/**
 * Single authoritative source for provider sensitivity policy + the fresh
 * re-auth window (plan/ai-safety.md item 8, cleanup task A6).
 *
 * This service owns the policy store (AppConfig), the ONE decision about what
 * may be sent to a provider, and the per-call opt-in re-auth timestamps. The
 * pure rank/classify primitives live in `@careeros/ai`; every provider-egress
 * path funnels through `assertAllowed` here.
 */
const APP_CONFIG_KEY = 'llm.sensitivity_policy';

// Fail-closed defaults. External providers never touch confidential+ data
// until the user explicitly opts in. Local embedding provider gets 'confidential'
// by default (no data leaves the host).
const DEFAULT_POLICY: ProviderPolicy = {
  deepseek: 'personal',
  openai: 'personal',
  anthropic: 'personal',
  azure: 'personal',
  openrouter: 'personal',
  ollama: 'confidential',
  local: 'confidential',
};

@Injectable()
export class SensitivityGateService {
  /** Per-(userId + opTag) expiry (ms epoch) of the last recorded re-auth. */
  private readonly reauth = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SensitivityGateService.name) private readonly logger: PinoLogger,
  ) {}

  async getPolicy(): Promise<ProviderPolicy> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_KEY } });
    const stored = (row?.value as ProviderPolicy | null) ?? {};
    return { ...DEFAULT_POLICY, ...stored };
  }

  async setProviderCeiling(providerName: string, ceiling: ProviderCeiling): Promise<void> {
    const current = await this.getPolicy();
    const next = { ...current, [providerName]: ceiling };
    await this.prisma.appConfig.upsert({
      where: { key: APP_CONFIG_KEY },
      create: { key: APP_CONFIG_KEY, value: next },
      update: { value: next },
    });
  }

  /**
   * Throws 503 if the provider isn't allowed to see data at the requested
   * sensitivity. Non-mutating: safe to call before instantiating the provider.
   * Delegates the rank comparison to the pure `decideProviderEgress` primitive.
   */
  async assertAllowed(providerName: string, sensitivity: Sensitivity, userId?: string): Promise<void> {
    if (!SENSITIVITY_LEVELS.includes(sensitivity)) {
      throw new Error(`Unknown sensitivity label: ${sensitivity}`);
    }
    const policy = await this.getPolicy();
    const decision = decideProviderEgress(providerName, sensitivity, policy);
    if (decision.allowed) return;

    if (decision.reason === 'not-permitted') {
      this.logger.warn(
        { providerName, ceiling: decision.ceiling, sensitivity, userId },
        'sensitivity gate blocked call',
      );
      throw new ServiceUnavailableException(
        `Provider '${providerName}' is not permitted (ceiling: ${decision.ceiling}). Adjust from Settings, Sensitivity policy.`,
      );
    }

    this.logger.warn(
      { providerName, ceiling: decision.ceiling, sensitivity, userId },
      'sensitivity gate blocked call: request above ceiling',
    );
    throw new ServiceUnavailableException(
      `Cannot send '${sensitivity}' data to '${providerName}' (ceiling: ${decision.ceiling}). Raise the ceiling in Settings, Sensitivity policy or route through a local provider.`,
    );
  }

  /**
   * Record a fresh re-auth for a given user + operation tag. Callers wire this
   * into the passkey / password re-verify path immediately after success. The
   * returned handle lets a test / debug tool inspect the deadline.
   */
  withReauthWindow(userId: string, opTag: string, windowMs = 300_000): { expiresAt: number } {
    const now = Date.now();
    const expiresAt = now + windowMs;
    this.reauth.set(reauthKey(userId, opTag), expiresAt);
    return { expiresAt };
  }

  /** True iff withReauthWindow(userId, opTag, ...) fired within its window. */
  hasFreshReauth(userId: string, opTag: string): boolean {
    const key = reauthKey(userId, opTag);
    const expiresAt = this.reauth.get(key);
    if (expiresAt == null) return false;
    if (Date.now() >= expiresAt) {
      // Drop stale entries opportunistically; Map stays small on a single-user host.
      this.reauth.delete(key);
      return false;
    }
    return true;
  }

  /** Test / debug helper — never called from prod code paths. */
  _clearReauth(): void {
    this.reauth.clear();
  }
}

function reauthKey(userId: string, opTag: string): string {
  return `${userId} ${opTag}`;
}
