// C-P2.7d: weekly corpus refresh. Runs every registered adapter, dedupes by
// exact `promptHash` first (unique index → cheap), then by embedding cosine
// similarity via Qdrant (fuzzy near-duplicate catch), and inserts survivors
// into `question_bank`. Idempotent — re-running the same Sunday twice
// inserts nothing new.
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { QdrantStore } from '@careeros/embeddings';
import { embedDeterministic } from '@careeros/embeddings';
import type { CorpusAdapter, CorpusItem } from './types';
import { adapters as defaultAdapters } from './registry';
import { DEFAULT_DUPLICATE_THRESHOLD } from './dedupe';

export const QUEUE_CORPUS_REFRESH = 'corpus-refresh';
export const JOB_CORPUS_REFRESH = 'corpus-refresh';
/** Sunday 04:00 UTC. Same off-hour slot as the retention worker. */
export const CORPUS_REFRESH_CRON = '0 4 * * 0';
/** Qdrant collection for corpus question vectors. Kept separate from user
 *  data so per-user filters never accidentally scope corpus lookups. */
export const CORPUS_COLLECTION = 'corpus_questions';
export const CORPUS_COLLECTION_DIM = 384;

/** Structural type — narrow to the two operations we call. Tests stub. */
export interface CorpusQuestionRepo {
  question: {
    findUnique: (args: { where: { promptHash: string } }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        kind: string;
        skillIds: string[];
        difficulty: string;
        prompt: string;
        keyPoints: string[];
        answerHint: string | null;
        promptHash: string;
        sourceKind: string;
        sourceUrl: string;
        sourceAttribution: string;
        embeddingId: string;
      };
    }) => Promise<{ id: string }>;
  };
}

/** Narrow Qdrant surface — the refresh worker only searches + upserts. */
export interface CorpusQdrant {
  ensureCollection(name: string, dim: number): Promise<void>;
  upsert(
    collection: string,
    points: Array<{ id: string; vector: number[]; payload?: Record<string, unknown> }>,
  ): Promise<void>;
  search(
    collection: string,
    vector: number[],
    limit?: number,
    filter?: unknown,
  ): Promise<Array<{ id: string | number; score: number }>>;
}

export interface AdapterSummary {
  adapter: string;
  fetched: number;
  dedupedHash: number;
  dedupedEmbed: number;
  inserted: number;
}

export interface RefreshResult {
  runAt: string;
  totals: { fetched: number; dedupedHash: number; dedupedEmbed: number; inserted: number };
  perAdapter: AdapterSummary[];
}

export interface RefreshOptions {
  adapters?: CorpusAdapter[];
  threshold?: number;
}

/**
 * Turn a stable seed into a canonical UUID (v5-like). Mirrors the helper in
 * `embedding-job.ts` — same shape so a corpus row's `embeddingId` is a valid
 * Qdrant point id whether it was written by this worker or the API. Copied
 * (not shared) because a shared helper package is more code than the 8 lines
 * it would move — ponytail: extract when a third caller shows up.
 */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  const v = chars[16]!;
  chars[16] = ((parseInt(v, 16) & 0x3) | 0x8).toString(16);
  const s = chars.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Run every adapter and persist new questions.
 * Pure(-ish) function of (prisma, qdrant, adapters) → summary — no BullMQ,
 * no cron, no globals. Tests drive it with in-memory stubs.
 */
export async function refreshCorpus(
  prisma: CorpusQuestionRepo,
  qdrant: CorpusQdrant,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const adapters = opts.adapters ?? defaultAdapters;
  const threshold = opts.threshold ?? DEFAULT_DUPLICATE_THRESHOLD;

  await qdrant.ensureCollection(CORPUS_COLLECTION, CORPUS_COLLECTION_DIM);

  const perAdapter: AdapterSummary[] = [];
  const totals = { fetched: 0, dedupedHash: 0, dedupedEmbed: 0, inserted: 0 };

  for (const adapter of adapters) {
    const summary: AdapterSummary = {
      adapter: adapter.id,
      fetched: 0,
      dedupedHash: 0,
      dedupedEmbed: 0,
      inserted: 0,
    };
    try {
      for await (const item of adapter.fetch()) {
        summary.fetched++;
        const inserted = await ingestOne(prisma, qdrant, item, adapter, threshold);
        if (inserted === 'hash-dup') summary.dedupedHash++;
        else if (inserted === 'embed-dup') summary.dedupedEmbed++;
        else summary.inserted++;
      }
    } catch (err) {
      logger.error(
        { adapter: adapter.id, err: (err as Error).message },
        'corpus adapter failed; continuing with remaining adapters',
      );
    }
    logger.info(summary, 'corpus adapter run complete');
    perAdapter.push(summary);
    totals.fetched += summary.fetched;
    totals.dedupedHash += summary.dedupedHash;
    totals.dedupedEmbed += summary.dedupedEmbed;
    totals.inserted += summary.inserted;
  }

  const result: RefreshResult = {
    runAt: new Date().toISOString(),
    totals,
    perAdapter,
  };
  logger.info({ job: JOB_CORPUS_REFRESH, ...result }, 'corpus refresh run complete');
  return result;
}

type IngestOutcome = 'inserted' | 'hash-dup' | 'embed-dup';

async function ingestOne(
  prisma: CorpusQuestionRepo,
  qdrant: CorpusQdrant,
  item: CorpusItem,
  adapter: CorpusAdapter,
  threshold: number,
): Promise<IngestOutcome> {
  // 1. Cheap exact-match dedupe.
  const existing = await prisma.question.findUnique({ where: { promptHash: item.promptHash } });
  if (existing) return 'hash-dup';

  // 2. Fuzzy dedupe. Encode → Qdrant top-3 → threshold check.
  const vector = embedDeterministic(item.body);
  const neighbours = await qdrant.search(CORPUS_COLLECTION, vector, 3);
  if (neighbours.some((n) => n.score >= threshold)) return 'embed-dup';

  // 3. Insert + upsert vector under a `promptHash`-derived stable point id.
  const embeddingId = deterministicUuid(`${CORPUS_COLLECTION}:${item.promptHash}`);
  await prisma.question.create({
    data: {
      kind: 'knowledge',
      skillIds: [],
      difficulty: 'medium',
      prompt: item.body,
      keyPoints: item.keyPoints ?? [],
      answerHint: null,
      promptHash: item.promptHash,
      sourceKind: adapter.id,
      sourceUrl: adapter.sourceUrl,
      sourceAttribution: `${adapter.name} (${adapter.license}). ${adapter.sourceUrl}`,
      embeddingId,
    },
  });
  await qdrant.upsert(CORPUS_COLLECTION, [
    {
      id: embeddingId,
      vector,
      payload: {
        source_id: adapter.id,
        source_kind: 'corpus',
        prompt_hash: item.promptHash,
        license: adapter.license,
      },
    },
  ]);
  return 'inserted';
}

/**
 * Job handler wired into BullMQ. Cast `QdrantStore` to `CorpusQdrant` — the
 * public method signatures line up, and this keeps tests free of Qdrant.
 */
export async function handleCorpusRefresh(
  prisma: CorpusQuestionRepo,
  qdrant: QdrantStore,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<RefreshResult> {
  return refreshCorpus(prisma, qdrant as unknown as CorpusQdrant, logger);
}
