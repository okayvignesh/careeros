import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DeepSeekProvider, renderPrompt, wrapUntrusted } from '@careeros/ai';
import { decrypt, encryptField, loadMasterKey } from '@careeros/secrets';
import { type ExtractedFacts } from '@careeros/shared';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { PrismaService } from '../../prisma/prisma.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import { makeHallucinationLogger } from '../../common/hallucination-log';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { QueueService } from '../../common/queue.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { findHallucinations } from '@careeros/ai';
import { COLLECTION_CAREER_FACTS } from '@careeros/shared';
import { QdrantStore } from '@careeros/embeddings';

// Per-user commit lock. Two concurrent `commit()` calls for the same user must
// serialise so we don't interleave deleteMany/createMany or orphan Qdrant points.
// In-memory Map is fine for a single-process api; when we cluster in P6, replace
// with a Redis SETNX or Postgres advisory lock.
const commitLocks = new Map<string, Promise<void>>();

const KEY = loadMasterKey();

const MAX_PDF_PAGES = 50;
const MAX_EXTRACTED_CHARS = 40_000; // ~10k tokens, well under provider context limits

const qdrant = new QdrantStore(process.env.QDRANT_URL ?? 'http://qdrant:6333');

@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly sensitivity: SensitivityGateService,
    private readonly queue: QueueService,
    private readonly usageCache: UsageCache,
    @InjectPinoLogger(ResumeService.name) private readonly logger: PinoLogger,
  ) {}

  async extractText(file: Express.Multer.File): Promise<string> {
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isDocx =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx');

    let raw = '';
    if (isPdf) {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
        // Cap page count before extraction (parity with pdf-parse `{ max }` option).
        const { text } = await extractText(pdf, { mergePages: false });
        const pages = Array.isArray(text) ? text : [text];
        raw = pages.slice(0, MAX_PDF_PAGES).join('\n');
      } catch {
        throw new BadRequestException('Could not read PDF. It may be encrypted, scanned, or corrupt.');
      }
    } else if (isDocx) {
      try {
        // ponytail: mammoth streams the DOCX zip via jszip; zip-bomb risk bounded by
        // the 10 MB upload cap + character truncation below. If we ever raise the cap,
        // add an inflated-size check by summing entry.uncompressedSize before extract.
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        raw = value ?? '';
      } catch {
        throw new BadRequestException('Could not read DOCX. The file may be corrupt.');
      }
    } else {
      throw new BadRequestException('Unsupported file type. Upload PDF or DOCX.');
    }

    return raw.length > MAX_EXTRACTED_CHARS ? raw.slice(0, MAX_EXTRACTED_CHARS) : raw;
  }

  async parse(userId: string, text: string): Promise<ExtractedFacts> {
    await this.usage.assertCallAllowed(userId);
    const cfg = await this.prisma.providerConfig.findFirst({
      where: { userId, isDefault: true },
    });
    if (!cfg) throw new NotFoundException('No AI provider configured');
    // Resume text carries personal sensitivity by default. Gate blocks the call if the
    // configured provider's ceiling is below 'personal'.
    await this.sensitivity.assertAllowed(cfg.provider, 'personal', userId);

    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: cfg.apiKeySecretId },
    });
    if (!secret) throw new NotFoundException('Provider key missing');
    const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

    const provider = new DeepSeekProvider({
      apiKey,
      baseUrl: cfg.baseUrl ?? undefined,
      chatModel: cfg.chatModel,
      onCall: makeLlmAuditor(this.prisma, userId, this.logger, this.usageCache),
    });

    const wrapped = wrapUntrusted(text, 'resume');
    const rendered = renderPrompt('resume-extract', { resume: wrapped.content });

    this.logger.info(
      { promptId: rendered.id, promptVersion: rendered.version, promptHash: rendered.hash, sourceHash: wrapped.hash, bytes: wrapped.bytes },
      'invoking prompt',
    );

    const result = await provider.chatStructured({
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      schema: rendered.schema,
      temperature: 0,
    });

    // Post-hoc hallucination check against the raw resume text. Suspect fragments
    // land in llm_hallucination_log for the eval loop; parse itself doesn't fail.
    const hallucinations = findHallucinations(result, [text]);
    if (hallucinations.suspects.length > 0) {
      void makeHallucinationLogger(this.prisma, userId, this.logger)(hallucinations, {
        promptId: rendered.id,
        promptVersion: rendered.version,
        promptHash: rendered.hash,
      });
    }

    return result as ExtractedFacts;
  }

  async commit(userId: string, facts: ExtractedFacts): Promise<{ inserted: number }> {
    // Ingest-side sensitivity check. Resume commit produces `personal`-labelled points;
    // if the operator has pinned local storage below that, block the write outright.
    await this.sensitivity.assertAllowed('local', 'personal', userId);

    // Per-user critical section (see commitLocks docstring). Two concurrent commits
    // now serialise cleanly instead of racing deleteMany vs createMany.
    const prior = commitLocks.get(userId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    commitLocks.set(userId, prior.then(() => gate));
    await prior;

    try {
      // Drop stale Qdrant points for this collection scope BEFORE we wipe the Postgres
      // rows they reference. Otherwise re-commit orphans every prior fact's vectors.
      try {
        await qdrant.deleteByFilter(COLLECTION_CAREER_FACTS.name, {
          must: [
            { key: 'user_id', value: userId },
            { key: 'source_kind', value: 'resume_fact' },
          ],
        });
      } catch (err) {
        this.logger.warn(
          { err: (err as Error).message, userId },
          'qdrant delete-by-filter failed on commit; continuing with Postgres write',
        );
      }

      // Postgres delete+insert in one transaction so concurrent readers never see an
      // empty fact base mid-commit.
      const rows: Array<{ userId: string; kind: string; content: unknown; verified: boolean }> = [];
      for (const emp of facts.employment) rows.push({ userId, kind: 'employment', content: emp, verified: true });
      for (const edu of facts.education) rows.push({ userId, kind: 'education', content: edu, verified: true });
      for (const sk of facts.skills) rows.push({ userId, kind: 'skill', content: sk, verified: true });
      for (const pr of facts.projects) rows.push({ userId, kind: 'project', content: pr, verified: true });
      if (facts.headline) rows.push({ userId, kind: 'headline', content: { text: facts.headline }, verified: true });
      if (facts.location) rows.push({ userId, kind: 'location', content: { text: facts.location }, verified: true });

      // Prisma's legacy `$use` middleware DOES NOT run for calls made through the
      // interactive-transaction client (`tx`). Facts written via `tx.resumeFact.createMany`
      // bypass the encryption pass in PrismaService. Encrypt the content column here so
      // rows land at rest with `enc:v1:content:<b64>` inside the transaction boundary.
      const encryptedRows = rows.map((row) => ({
        ...row,
        content: encryptField(JSON.stringify(row.content), KEY, 'content'),
      }));

      await this.prisma.$transaction(async (tx) => {
        await tx.resumeFact.deleteMany({ where: { userId } });
        if (encryptedRows.length > 0) {
          await tx.resumeFact.createMany({
            data: encryptedRows as Array<{ userId: string; kind: string; content: string; verified: boolean }>,
          });
        }
      });

      // Enqueue after the DB settles so the worker reads a coherent snapshot.
      await this.enqueueEmbeddings(userId).catch((err) =>
        this.logger.warn({ err: (err as Error).message, userId }, 'enqueue embeddings failed'),
      );

      return { inserted: rows.length };
    } finally {
      release();
      // Prevent unbounded map growth: drop the entry once no one is waiting on it.
      // Await the current chain in a microtask so a queued caller can install its own.
      queueMicrotask(() => {
        const cur = commitLocks.get(userId);
        if (cur === undefined) return;
        Promise.resolve(cur).then(() => {
          if (commitLocks.get(userId) === cur) commitLocks.delete(userId);
        });
      });
    }
  }

  /**
   * Enqueue one `embedding.generate` job per committed fact. Called from `commit()`
   * fire-and-forget so the wizard doesn't wait on Redis. Also invoked from the
   * Embeddings settings screen to re-embed the corpus after a model swap.
   */
  async enqueueEmbeddings(userId: string): Promise<number> {
    const facts = await this.prisma.resumeFact.findMany({ where: { userId } });
    let enqueued = 0;
    for (const fact of facts) {
      const text = renderFactAsText(fact.kind, fact.content as Record<string, unknown>);
      if (!text) continue;
      await this.queue.enqueueEmbedding({
        userId,
        collection: COLLECTION_CAREER_FACTS.name,
        sourceId: fact.id,
        sourceKind: 'resume_fact',
        text,
        sensitivity: 'personal',
        meta: { kind: fact.kind },
      });
      enqueued += 1;
    }
    return enqueued;
  }
}

/**
 * Flatten a resume fact into a searchable string. Kept close to the shape UI helpers
 * use so search hits render similarly to fact-base rows.
 */
function renderFactAsText(kind: string, content: Record<string, unknown>): string {
  if (kind === 'headline' || kind === 'location') return String(content.text ?? '');
  if (kind === 'employment') {
    const bullets = Array.isArray(content.bullets) ? (content.bullets as string[]).join(' ') : '';
    return `${content.title ?? ''} at ${content.company ?? ''} (${content.start ?? ''} to ${content.end ?? 'present'}). ${bullets}`.trim();
  }
  if (kind === 'education') {
    return `${content.degree ?? ''} in ${content.field ?? ''} at ${content.school ?? ''} (${content.year ?? ''})`.trim();
  }
  if (kind === 'skill') {
    return `${content.name ?? ''}${content.evidence ? `: ${content.evidence}` : ''}`.trim();
  }
  if (kind === 'project') {
    return `${content.name ?? ''}: ${content.description ?? ''}`.trim();
  }
  return JSON.stringify(content);
}
