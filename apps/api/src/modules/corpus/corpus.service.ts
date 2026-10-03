import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { KeyPointsExtraction } from '@careeros/shared';
import { renderPrompt, wrapUntrusted, type AIProvider } from '@careeros/ai';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ProviderLoaderService } from '../../common/provider-loader.service';
import type { CorpusAdapter, IngestedQuestion } from './types';
import { systemDesignPrimerAdapter } from './adapters/system-design-primer';

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
    private readonly providerLoader: ProviderLoaderService,
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
        const extracted = await this.extractKeyPoints(userId, provider, q.prompt).catch((err) => {
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
    userId: string,
    provider: AIProvider,
    question: string,
  ): Promise<KeyPointsExtraction | null> {
    const wrapped = wrapUntrusted(question, 'readme', { userId });
    const rendered = renderPrompt('keypoints-extractor', { question: wrapped.content });
    // A-M9: per-user LLM concurrency ceiling.
    const result = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.2,
        meta: {
          promptId: rendered.id,
          promptVersion: rendered.version,
          promptHash: rendered.hash,
          sensitivity: 'public',
        },
      }),
    )) as KeyPointsExtraction;
    return result;
  }

  /**
   * Corpus ingestion is a distinct call-site with its own sensitivity story:
   * the input is public open-source content, so we gate on `public` not
   * `personal`. Sequencing is delegated to `ProviderLoaderService`.
   */
  private async tryLoadProvider(userId: string): Promise<AIProvider | null> {
    try {
      const loaded = await this.providerLoader.loadProviderForUser(userId, 'public');
      return loaded?.provider ?? null;
    } catch (err) {
      this.logger.warn(`corpus: provider unavailable, ingestion will skip keyPoints extraction: ${(err as Error).message}`);
      return null;
    }
  }
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 32);
}
