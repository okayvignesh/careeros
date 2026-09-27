import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { KeyPointsExtraction } from '@careeros/shared';
import { DeepSeekProvider, renderPrompt, wrapUntrusted } from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import type { CorpusAdapter, IngestedQuestion } from './types';
import { systemDesignPrimerAdapter } from './adapters/system-design-primer';

const KEY = loadMasterKey();

export interface SyncStats {
  adapter: string;
  fetched: number;
  extracted: number;
  inserted: number;
  deduped: number;
  skippedNoKeyPoints: number;
}

@Injectable()
export class CorpusService {
  private readonly logger = new Logger(CorpusService.name);
  private readonly adapters: Record<string, CorpusAdapter> = {
    [systemDesignPrimerAdapter.id]: systemDesignPrimerAdapter,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  listAdapters(): Array<Pick<CorpusAdapter, 'id' | 'name' | 'licenseSpdx' | 'sourceUrl'>> {
    return Object.values(this.adapters).map((a) => ({
      id: a.id,
      name: a.name,
      licenseSpdx: a.licenseSpdx,
      sourceUrl: a.sourceUrl,
    }));
  }

  /**
   * Fetch questions from an adapter, LLM-extract keyPoints for each, upsert
   * into `question_bank` with source attribution. Dedupe via existing
   * `promptHash` unique constraint (same question text → no-op). Uses the
   * operator's default provider config for keyPoints extraction; if no
   * provider is configured, ingestion skips rows that lack keyPoints (the
   * rule-based grader can't score them, so serving them is worse than not).
   */
  async sync(userId: string, adapterId: string): Promise<SyncStats> {
    const adapter = this.adapters[adapterId];
    if (!adapter) throw new NotFoundException(`Unknown corpus adapter: ${adapterId}`);

    const stats: SyncStats = {
      adapter: adapterId,
      fetched: 0,
      extracted: 0,
      inserted: 0,
      deduped: 0,
      skippedNoKeyPoints: 0,
    };

    const questions = await adapter.fetch();
    stats.fetched = questions.length;
    if (questions.length === 0) {
      this.logger.warn(
        `Adapter ${adapterId} returned 0 questions. Source layout may have changed; check the parser.`,
      );
      return stats;
    }

    const provider = await this.tryLoadProvider(userId);
    for (const q of questions) {
      const promptHash = hashPrompt(q.prompt);
      const existing = await this.prisma.question.findUnique({ where: { promptHash } });
      if (existing) {
        stats.deduped++;
        continue;
      }

      let keyPoints: string[] = [];
      if (provider) {
        const extracted = await this.extractKeyPoints(provider, q.prompt).catch((err) => {
          this.logger.warn(`keyPoints extraction failed for prompt: ${(err as Error).message}`);
          return null;
        });
        if (extracted) {
          keyPoints = extracted.keyPoints;
          stats.extracted++;
        }
      }

      if (keyPoints.length === 0) {
        // Without keyPoints, the grader can't score. Skip rather than serve
        // an ungradeable question.
        stats.skippedNoKeyPoints++;
        continue;
      }

      await this.prisma.question.create({
        data: {
          kind: 'knowledge',
          skillIds: q.skillIds,
          difficulty: q.difficulty,
          prompt: q.prompt,
          keyPoints,
          answerHint: q.answerHint ?? null,
          promptHash,
          sourceKind: adapter.id,
          sourceUrl: adapter.sourceUrl,
          sourceAttribution: adapter.attribution,
        },
      });
      stats.inserted++;
    }

    return stats;
  }

  private async extractKeyPoints(
    provider: DeepSeekProvider,
    question: string,
  ): Promise<KeyPointsExtraction | null> {
    const wrapped = wrapUntrusted(question, 'readme');
    const rendered = renderPrompt('keypoints-extractor', { question: wrapped.content });
    const result = (await provider.chatStructured({
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      schema: rendered.schema,
      temperature: 0.2,
    })) as KeyPointsExtraction;
    return result;
  }

  /**
   * Same load-provider pattern as `AssessmentsService.runLlmGraderOrFallback`
   * but inlined here since corpus ingestion is a distinct call-site with its
   * own sensitivity story: the input is public open-source content, so we
   * gate on `public` not `personal`.
   */
  private async tryLoadProvider(userId: string): Promise<DeepSeekProvider | null> {
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg || cfg.provider !== 'deepseek') return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
      return new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });
    } catch (err) {
      this.logger.warn(`corpus: provider unavailable, ingestion will skip keyPoints extraction: ${(err as Error).message}`);
      return null;
    }
  }
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 32);
}
