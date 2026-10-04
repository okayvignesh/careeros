// Semantic search over Qdrant. Query text is embedded through the process-wide
// EmbeddingProvider seam (semantic under `EMBEDDING_MODE=local`, deterministic
// fallback offline). Stored vectors written before this switch are deterministic
// and won't match semantic queries until re-embedded: settings "Re-embed"
// (`POST /embeddings/reembed`) for resume facts; rebuild `corpus_questions` for
// corpus questions (no per-row path — see refresh.worker.ts).
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  QdrantStore,
  createProviderFromResolved,
  loadResolvedEmbeddingConfig,
  EMBEDDING_API_KEY_PURPOSE,
  type EmbeddingLogger,
  type EmbeddingProvider,
  type PayloadFilter,
} from '@careeros/embeddings';
import { decryptField, loadMasterKey } from '@careeros/secrets';
import { ALL_COLLECTIONS, COLLECTION_CAREER_FACTS, SENSITIVITY_LEVELS } from '@careeros/shared';
import { rankOf, type Sensitivity } from '@careeros/ai';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchHitDto {
  score: number;
  chunkIdx: number;
  sourceId: string;
  collection: string;
  sensitivity: Sensitivity;
  /** Rehydrated payload from Postgres. Shape depends on `source_kind`. */
  source: Record<string, unknown> | null;
}

@Injectable()
export class SearchService {
  private readonly qdrant: QdrantStore;
  /** Lazily resolved from `app_config` (falls back to EMBEDDING_MODE). Cached per process. */
  private embeddingsPromise: Promise<EmbeddingProvider> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SearchService.name) private readonly logger: PinoLogger,
  ) {
    this.qdrant = new QdrantStore(process.env.QDRANT_URL ?? 'http://qdrant:6333');
  }

  /**
   * Resolve the query embedder from the saved config so query vectors match how
   * the worker embedded the stored points (external 1536-d config included).
   * Created once per process; `external` without a saved config throws rather
   * than silently using deterministic vectors against a different-dimension collection.
   */
  private getEmbeddings(): Promise<EmbeddingProvider> {
    if (!this.embeddingsPromise) {
      const embedLogger: EmbeddingLogger = {
        warn: (obj, msg) => this.logger.warn({ ...obj }, msg),
      };
      const cacheDir = process.env.EMBEDDING_MODEL_CACHE_DIR;
      this.embeddingsPromise = (async () => {
        const resolved = await loadResolvedEmbeddingConfig(this.prisma, {
          envMode: process.env.EMBEDDING_MODE,
          decryptApiKey: (stored) =>
            decryptField(stored, loadMasterKey(), EMBEDDING_API_KEY_PURPOSE),
          logger: embedLogger,
        });
        return createProviderFromResolved(resolved, {
          logger: embedLogger,
          ...(cacheDir ? { cacheDir } : {}),
        });
      })();
      // A transient resolve failure (e.g. DB blip) must not cache a rejected
      // promise forever; next query retries.
      this.embeddingsPromise.catch(() => {
        this.embeddingsPromise = undefined;
      });
    }
    return this.embeddingsPromise;
  }

  async search(
    userId: string,
    query: string,
    options: {
      collection?: string;
      limit?: number;
      /** Max sensitivity the caller is willing to surface. Defaults to 'personal'. */
      maxSensitivity?: Sensitivity;
    } = {},
  ): Promise<SearchHitDto[]> {
    const trimmed = (query ?? '').trim();
    if (trimmed.length === 0) return [];
    if (trimmed.length > 2_000) throw new BadRequestException('query too long (max 2000 chars).');

    const collection = options.collection ?? COLLECTION_CAREER_FACTS.name;
    const def = ALL_COLLECTIONS.find((c) => c.name === collection);
    if (!def) throw new BadRequestException(`unknown collection: ${collection}`);

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const maxSensitivity: Sensitivity = options.maxSensitivity ?? 'personal';
    const maxRank = rankOf(maxSensitivity);

    const vector = await (await this.getEmbeddings()).embed(trimmed);
    // Server-side filter: user isolation is Qdrant's responsibility, not the api's.
    // `sensitivity: {any: allowedLabels}` avoids surfacing labels above the ceiling.
    const allowedLabels = SENSITIVITY_LEVELS.filter((l) => rankOf(l) <= maxRank);
    const filter: PayloadFilter = {
      must: [
        { key: 'user_id', value: userId },
        { key: 'sensitivity', any: [...allowedLabels] },
      ],
    };
    const hits = await this.qdrant.search(collection, vector, limit * 3, filter);
    this.logger.info({ userId, collection, matched: hits.length }, 'qdrant search complete');

    const dedupedBySource = new Map<string, (typeof hits)[number]>();
    for (const h of hits) {
      const p = (h.payload as Record<string, unknown> | undefined) ?? {};
      const sid = String(p.source_id ?? h.id);
      const existing = dedupedBySource.get(sid);
      if (!existing || h.score > existing.score) dedupedBySource.set(sid, h);
    }

    const top = [...dedupedBySource.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    return this.rehydrate(top, collection);
  }

  private async rehydrate(
    hits: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | undefined }>,
    collection: string,
  ): Promise<SearchHitDto[]> {
    if (collection === COLLECTION_CAREER_FACTS.name) {
      const ids = hits
        .map((h) => (h.payload as { source_id?: string } | undefined)?.source_id)
        .filter((v): v is string => typeof v === 'string');
      const facts = await this.prisma.resumeFact.findMany({
        where: { id: { in: ids } },
        select: { id: true, kind: true, content: true },
      });
      const byId = new Map(facts.map((f) => [f.id, f]));
      return hits.map((h) => {
        const p = (h.payload ?? {}) as Record<string, unknown>;
        const sourceId = String(p.source_id ?? '');
        const fact = byId.get(sourceId) ?? null;
        return {
          score: h.score,
          chunkIdx: Number(p.chunk_idx ?? 0),
          sourceId,
          collection,
          sensitivity: (p.sensitivity as Sensitivity | undefined) ?? 'personal',
          source: fact ? { kind: fact.kind, content: fact.content } : null,
        };
      });
    }
    // Other collections rehydrate off Postgres tables that don't exist yet. Return the
    // raw payload so callers can at least see the hit.
    return hits.map((h) => {
      const p = (h.payload ?? {}) as Record<string, unknown>;
      return {
        score: h.score,
        chunkIdx: Number(p.chunk_idx ?? 0),
        sourceId: String(p.source_id ?? h.id),
        collection,
        sensitivity: (p.sensitivity as Sensitivity | undefined) ?? 'personal',
        source: p,
      };
    });
  }
}
