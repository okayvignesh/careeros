import { Injectable } from '@nestjs/common';
import { QdrantStore, embedDeterministic, EMBED_DIM } from '@careeros/embeddings';
import { PrismaService } from '../../prisma/prisma.service';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://qdrant:6333';
const TEST_COLLECTION = '_setup_test';

export interface EmbeddingConfig {
  mode: 'local' | 'external';
  model: string;
  externalBaseUrl?: string | undefined;
  externalApiKey?: string | undefined;
}

export interface TestResult {
  qdrantReachable: boolean;
  qdrantLatencyMs: number;
  upsertOk: boolean;
  searchOk: boolean;
  topScore: number;
  error?: string;
}

@Injectable()
export class EmbeddingsService {
  private store = new QdrantStore(QDRANT_URL);

  constructor(private readonly prisma: PrismaService) {}

  async saveConfig(cfg: EmbeddingConfig): Promise<void> {
    await this.prisma.appConfig.upsert({
      where: { key: 'embedding' },
      create: { key: 'embedding', value: cfg as unknown as object },
      update: { value: cfg as unknown as object },
    });
  }

  async getConfig(): Promise<EmbeddingConfig | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: 'embedding' } });
    return (row?.value as unknown as EmbeddingConfig) ?? null;
  }

  async test(sampleText = 'Career OS embedding round-trip check'): Promise<TestResult> {
    const t0 = Date.now();
    const reachable = await this.store.ping();
    if (!reachable) {
      return {
        qdrantReachable: false,
        qdrantLatencyMs: Date.now() - t0,
        upsertOk: false,
        searchOk: false,
        topScore: 0,
        error: 'Qdrant unreachable',
      };
    }
    const qdrantLatencyMs = Date.now() - t0;

    try {
      await this.store.ensureCollection(TEST_COLLECTION, EMBED_DIM);
      const vec = embedDeterministic(sampleText);
      const id = Date.now();
      await this.store.upsert(TEST_COLLECTION, [
        { id, vector: vec, payload: { text: sampleText } },
      ]);
      const hits = await this.store.search(TEST_COLLECTION, vec, 1);
      const top = hits[0];
      const upsertOk = true;
      const searchOk = !!top && top.id === id && top.score > 0.99;
      return {
        qdrantReachable: true,
        qdrantLatencyMs,
        upsertOk,
        searchOk,
        topScore: top?.score ?? 0,
      };
    } catch (e) {
      return {
        qdrantReachable: true,
        qdrantLatencyMs,
        upsertOk: false,
        searchOk: false,
        topScore: 0,
        error: (e as Error).message,
      };
    }
  }
}
