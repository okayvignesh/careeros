import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SENSITIVITY_LEVELS, rankOf, type Sensitivity } from '@careeros/ai';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-provider sensitivity ceiling.
 *   'block'        → this provider may never see any user data (kill switch)
 *   'local-only'   → only the local embedding path may use it (external providers never)
 *   'public'       → public data only (job descriptions, READMEs)
 *   'personal'     → up to personal (resume, user input)
 *   'confidential' → up to confidential (private repos)
 *   'employer-confidential' → any label (opt-in per repo)
 */
export type ProviderCeiling =
  | 'block'
  | 'local-only'
  | 'public'
  | 'personal'
  | 'confidential'
  | 'employer-confidential';

const APP_CONFIG_KEY = 'llm.sensitivity_policy';

// Fail-closed defaults. External providers never touch confidential+ data
// until the user explicitly opts in. Local embedding provider gets 'confidential'
// by default (no data leaves the host).
const DEFAULT_POLICY: Record<string, ProviderCeiling> = {
  deepseek: 'personal',
  openai: 'personal',
  anthropic: 'personal',
  azure: 'personal',
  openrouter: 'personal',
  ollama: 'confidential',
  local: 'confidential',
};

const CEILING_RANK: Record<ProviderCeiling, number> = {
  block: -2,
  'local-only': -1,
  public: rankOf('public'),
  personal: rankOf('personal'),
  confidential: rankOf('confidential'),
  'employer-confidential': rankOf('employer-confidential'),
};

@Injectable()
export class SensitivityGateService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SensitivityGateService.name) private readonly logger: PinoLogger,
  ) {}

  async getPolicy(): Promise<Record<string, ProviderCeiling>> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_KEY } });
    const stored = (row?.value as Record<string, ProviderCeiling> | null) ?? {};
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
   * Throws 503 if the provider isn't allowed to see data at the requested sensitivity.
   * Non-mutating: safe to call before instantiating the provider.
   */
  async assertAllowed(providerName: string, sensitivity: Sensitivity, userId?: string): Promise<void> {
    if (!SENSITIVITY_LEVELS.includes(sensitivity)) {
      throw new Error(`Unknown sensitivity label: ${sensitivity}`);
    }
    const policy = await this.getPolicy();
    const ceiling = policy[providerName] ?? 'block';

    if (ceiling === 'block' || ceiling === 'local-only') {
      this.logger.warn(
        { providerName, ceiling, sensitivity, userId },
        'sensitivity gate blocked call',
      );
      throw new ServiceUnavailableException(
        `Provider '${providerName}' is not permitted (ceiling: ${ceiling}). Adjust from Settings, Sensitivity policy.`,
      );
    }

    if (rankOf(sensitivity) > CEILING_RANK[ceiling]) {
      this.logger.warn(
        { providerName, ceiling, sensitivity, userId },
        'sensitivity gate blocked call: request above ceiling',
      );
      throw new ServiceUnavailableException(
        `Cannot send '${sensitivity}' data to '${providerName}' (ceiling: ${ceiling}). Raise the ceiling in Settings, Sensitivity policy or route through a local provider.`,
      );
    }
  }
}
