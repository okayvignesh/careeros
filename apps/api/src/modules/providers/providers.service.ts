import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DeepSeekProvider, probeProvider, type ProbeResult } from '@careeros/ai';
import { encrypt, decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';

const KEY = loadMasterKey();

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly sensitivity: SensitivityGateService,
    private readonly usageCache: UsageCache,
    @InjectPinoLogger(ProvidersService.name) private readonly logger: PinoLogger,
  ) {}

  async saveProvider(
    userId: string,
    input: {
      provider: string;
      apiKey: string;
      chatModel: string;
      reasoningModel?: string | undefined;
      baseUrl?: string | undefined;
    },
  ) {
    const purpose = `provider:${input.provider}:apiKey`;
    const ciphertext = encrypt(input.apiKey, KEY, purpose);

    // Upsert the encrypted secret for this user + purpose.
    const secret = await this.prisma.encryptedSecret.upsert({
      where: {
        ownerType_ownerId_purpose: { ownerType: 'user', ownerId: userId, purpose },
      },
      create: { ownerType: 'user', ownerId: userId, purpose, ciphertext },
      update: { ciphertext },
    });

    // Deactivate other providers, mark this one default.
    await this.prisma.providerConfig.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    const cfg = await this.prisma.providerConfig.upsert({
      where: { id: await this.findExistingId(userId, input.provider) },
      create: {
        userId,
        provider: input.provider,
        chatModel: input.chatModel,
        reasoningModel: input.reasoningModel ?? null,
        baseUrl: input.baseUrl ?? null,
        apiKeySecretId: secret.id,
        isDefault: true,
      },
      update: {
        chatModel: input.chatModel,
        reasoningModel: input.reasoningModel ?? null,
        baseUrl: input.baseUrl ?? null,
        apiKeySecretId: secret.id,
        isDefault: true,
      },
    });

    return { id: cfg.id, provider: cfg.provider, chatModel: cfg.chatModel };
  }

  async probe(userId: string): Promise<ProbeResult> {
    await this.usage.assertCallAllowed(userId);
    const cfg = await this.prisma.providerConfig.findFirst({
      where: { userId, isDefault: true },
    });
    if (!cfg) throw new NotFoundException('No provider configured');
    // Probe uses public dummy content (no user data), so `public` is the right label.
    await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: cfg.apiKeySecretId },
    });
    if (!secret) throw new NotFoundException('Provider key missing');

    const purpose = `provider:${cfg.provider}:apiKey`;
    const apiKey = decrypt(secret.ciphertext, KEY, purpose);

    if (cfg.provider !== 'deepseek') {
      throw new NotFoundException(`Adapter for '${cfg.provider}' not implemented yet.`);
    }
    const provider = new DeepSeekProvider({
      apiKey,
      baseUrl: cfg.baseUrl ?? undefined,
      chatModel: cfg.chatModel,
      onCall: makeLlmAuditor(this.prisma, userId, this.logger, this.usageCache),
    });
    return probeProvider(provider);
  }

  async listProviders(userId: string) {
    const rows = await this.prisma.providerConfig.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { provider: 'asc' }],
      select: {
        id: true,
        provider: true,
        chatModel: true,
        reasoningModel: true,
        baseUrl: true,
        isDefault: true,
      },
    });
    return rows;
  }

  async setDefault(userId: string, id: string): Promise<void> {
    const target = await this.prisma.providerConfig.findFirst({ where: { id, userId } });
    if (!target) throw new NotFoundException('Provider not found');
    await this.prisma.$transaction([
      this.prisma.providerConfig.updateMany({ where: { userId }, data: { isDefault: false } }),
      this.prisma.providerConfig.update({ where: { id }, data: { isDefault: true } }),
    ]);
  }

  private async findExistingId(userId: string, provider: string): Promise<string> {
    const existing = await this.prisma.providerConfig.findFirst({
      where: { userId, provider },
      select: { id: true },
    });
    return existing?.id ?? '00000000-0000-0000-0000-000000000000';
  }
}
