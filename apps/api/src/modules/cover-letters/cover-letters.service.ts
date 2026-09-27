import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CoverLetterContent } from '@careeros/shared';
import { renderCoverLetterPdf } from '@careeros/resume-render';
import {
  DeepSeekProvider,
  renderPrompt,
  runFactCheck,
  wrapUntrusted,
  type FactCheckClaim,
} from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { makeLlmAuditor } from '../../common/llm-audit';

const KEY = loadMasterKey();

export interface FactRefInfo {
  id: string;
  kind: string;
  summary: string;
}
export interface DroppedParagraph {
  index: number;
  text: string;
  reason: string;
}
export type AuditStatus = 'passed' | 'partial' | 'unchecked';
export interface FactCheckAudit {
  status: AuditStatus;
  paragraphsChecked: number;
  paragraphsPassed: number;
  paragraphsDropped: number;
  dropped: DroppedParagraph[];
}

export interface CoverLetterDto {
  id: string;
  jobId: string | null;
  jobTitle: string | null;
  jobCompany: string | null;
  roleTarget: string;
  templateId: string;
  content: CoverLetterContent;
  factRefs: FactRefInfo[];
  audit: FactCheckAudit;
  createdAt: string;
}

@Injectable()
export class CoverLettersService {
  private readonly logger = new Logger(CoverLettersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  async listForUser(userId: string): Promise<Array<Omit<CoverLetterDto, 'content' | 'factRefs' | 'audit'>>> {
    const rows = await this.prisma.coverLetter.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const jobIds = rows.map((r) => r.jobId).filter((id): id is string => !!id);
    const jobs = jobIds.length
      ? await this.prisma.normalizedJob.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true, company: true },
        })
      : [];
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return rows.map((r) => {
      const j = r.jobId ? jobById.get(r.jobId) : undefined;
      return {
        id: r.id,
        jobId: r.jobId,
        jobTitle: j?.title ?? null,
        jobCompany: j?.company ?? null,
        roleTarget: r.roleTarget,
        templateId: r.templateId,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async getById(userId: string, id: string): Promise<CoverLetterDto> {
    const row = await this.prisma.coverLetter.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Cover letter not found');
    const job = row.jobId
      ? await this.prisma.normalizedJob.findUnique({
          where: { id: row.jobId },
          select: { title: true, company: true },
        })
      : null;
    const factRefs = await this.loadFactRefs(userId, row.factRefs);
    const { content, audit } = unwrapContentJson(row.contentJson);
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: job?.title ?? null,
      jobCompany: job?.company ?? null,
      roleTarget: row.roleTarget,
      templateId: row.templateId,
      content,
      audit,
      factRefs,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async generateForJob(userId: string, jobId: string): Promise<CoverLetterDto> {
    const job = await this.prisma.normalizedJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const facts = await this.prisma.resumeFact.findMany({
      where: { userId, verified: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    if (facts.length === 0) {
      throw new BadRequestException(
        'No verified resume facts. Add facts on /facts (or re-run resume ingest) first.',
      );
    }

    const provider = await this.tryLoadProvider(userId);
    if (!provider) {
      throw new BadRequestException(
        'LLM provider not configured or paused; cover-letter generation needs an LLM.',
      );
    }

    const factsRendered = facts
      .map((f) => `- id=${f.id} kind=${f.kind} ${summariseFact(f.content)}`)
      .join('\n');

    const descWrapped = wrapUntrusted(job.description, 'job-description');
    const rendered = renderPrompt('cover-letter-writer', {
      jobTitle: job.title,
      jobCompany: job.company,
      jobDescription: descWrapped.content,
      facts: factsRendered,
    });
    // A-M9: per-user LLM concurrency ceiling.
    const raw = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.3,
      }),
    )) as CoverLetterContent;

    // Hallucination guard: drop cited fact IDs that aren't in our list. Unlike
    // resume bullets (where empty-refs → drop bullet), a cover-letter paragraph
    // with zero valid refs is dropped too — every paragraph must be grounded.
    const knownIds = new Set(facts.map((f) => f.id));
    const cleanedParagraphs = raw.paragraphs
      .map((p) => ({
        text: p.text,
        factRefs: p.factRefs.filter((id) => knownIds.has(id)),
      }))
      .filter((p) => p.factRefs.length > 0);

    if (cleanedParagraphs.length === 0) {
      throw new BadRequestException(
        'LLM produced no paragraphs grounded in your verified facts. Try adding more facts and re-generate.',
      );
    }

    // Fact-check pass (paragraph-level). Reuses the same `resume-bullet-fact-check`
    // prompt since the shape is identical (indexed items with cited fact refs).
    const factById = new Map(facts.map((f) => [f.id, f]));
    const { finalParagraphs, audit } = await this.runFactCheck(userId, provider, cleanedParagraphs, factById);

    if (finalParagraphs.length === 0) {
      throw new BadRequestException(
        'Fact-check dropped every paragraph. The LLM likely fabricated claims beyond your verified facts.',
      );
    }

    const finalContent: CoverLetterContent = {
      greeting: raw.greeting,
      paragraphs: finalParagraphs,
      closing: raw.closing,
    };
    const allRefs = Array.from(new Set(finalParagraphs.flatMap((p) => p.factRefs)));

    const persistPayload = { content: finalContent, audit };
    const row = await this.prisma.coverLetter.create({
      data: {
        userId,
        jobId,
        roleTarget: job.title,
        contentJson: persistPayload as unknown as Prisma.InputJsonValue,
        factRefs: allRefs,
      },
    });
    return this.getById(userId, row.id);
  }

  /** Render the cover letter as PDF via `@careeros/resume-render`. */
  async renderPdf(userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const letter = await this.getById(userId, id);
    const buffer = await renderCoverLetterPdf({
      roleTarget: letter.roleTarget,
      jobCompany: letter.jobCompany,
      content: letter.content,
    });
    const safeCompany = (letter.jobCompany ?? 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return { buffer, filename: `cover-letter-${safeCompany}-${letter.id.slice(0, 8)}.pdf` };
  }

  private async runFactCheck(
    userId: string,
    provider: DeepSeekProvider,
    paragraphs: CoverLetterContent['paragraphs'],
    factById: Map<string, { id: string; kind: string; content: Prisma.JsonValue }>,
  ): Promise<{ finalParagraphs: CoverLetterContent['paragraphs']; audit: FactCheckAudit }> {
    // Reuse the shared C-P4.7a gate. Paragraph shape maps 1:1 to Claim; the
    // per-paragraph drop + audit stays here (cover-letter domain shape).
    const claims: FactCheckClaim[] = paragraphs.map((p, i) => ({
      index: i,
      text: p.text,
      cited: p.factRefs.map((id) => {
        const f = factById.get(id);
        return f
          ? { id: f.id, kind: f.kind, summary: summariseFact(f.content) }
          : { id, kind: 'missing', summary: '(MISSING)' };
      }),
    }));

    // A-M9 concurrency ceiling passed through to the shared gate.
    const outcome = await runFactCheck({
      provider,
      claims,
      runWithUserLimit: (fn) => this.usage.runWithUserLimit(userId, fn),
    });

    if (!outcome.ok) {
      this.logger.warn(`cover-letter fact-check failed, marking unchecked: ${outcome.reason}`);
      return {
        finalParagraphs: paragraphs,
        audit: {
          status: 'unchecked',
          paragraphsChecked: 0,
          paragraphsPassed: paragraphs.length,
          paragraphsDropped: 0,
          dropped: [],
        },
      };
    }

    const verdicts = outcome.verdicts;
    const dropped: DroppedParagraph[] = [];
    let passed = 0;
    const finalParagraphs = paragraphs.filter((p, i) => {
      const v = verdicts.get(i);
      // Missing verdict = DROP (same trust-critical default as resume slice).
      if (!v) {
        dropped.push({ index: i, text: p.text, reason: 'no verdict returned by fact-check' });
        return false;
      }
      if (v.supported) {
        passed++;
        return true;
      }
      dropped.push({ index: i, text: p.text, reason: v.reason });
      return false;
    });

    for (const d of dropped) {
      await this.auditDropped(userId, d.text, d.reason);
    }
    const status: AuditStatus = dropped.length === 0 ? 'passed' : 'partial';
    return {
      finalParagraphs,
      audit: {
        status,
        paragraphsChecked: paragraphs.length,
        paragraphsPassed: passed,
        paragraphsDropped: dropped.length,
        dropped,
      },
    };
  }

  /** Cross-service audit row on every dropped claim. Never throws. */
  private async auditDropped(userId: string, claim: string, reason: string): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'system',
          action: 'factcheck.claim.dropped',
          resourceType: 'cover_letter',
          resourceId: userId,
          payload: { service: 'cover-letters', claim, reason },
        },
      });
    } catch {
      /* audit must not throw (also silent when the test fake omits auditEvent) */
    }
  }

  private async loadFactRefs(userId: string, ids: string[]): Promise<FactRefInfo[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.resumeFact.findMany({
      where: { userId, id: { in: ids } },
    });
    return rows.map((f) => ({ id: f.id, kind: f.kind, summary: summariseFact(f.content) }));
  }

  private async tryLoadProvider(userId: string): Promise<DeepSeekProvider | null> {
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg || cfg.provider !== 'deepseek') return null;
      // Resume facts + job description = personal.
      await this.sensitivity.assertAllowed(cfg.provider, 'personal', userId);
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
      this.logger.warn(`cover-letters: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * Read `cover_letters.contentJson` handling both the `{content, audit}` wrapper
 * (current) and any bare-content legacy shape (defensive; no such rows exist
 * today but symmetric with the resume-variants unwrap so behavior is uniform).
 */
function unwrapContentJson(
  raw: Prisma.JsonValue,
): { content: CoverLetterContent; audit: FactCheckAudit } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj && 'content' in obj && 'audit' in obj) {
    return {
      content: obj.content as unknown as CoverLetterContent,
      audit: obj.audit as unknown as FactCheckAudit,
    };
  }
  return {
    content: raw as unknown as CoverLetterContent,
    audit: {
      status: 'unchecked',
      paragraphsChecked: 0,
      paragraphsPassed: 0,
      paragraphsDropped: 0,
      dropped: [],
    },
  };
}

/**
 * Compact one-line summary of a resume fact for prompt injection. Duplicated
 * from resume-variants.service — extract to a shared helper when a third caller
 * lands (ponytail rule: three similar things is where extraction is worth it).
 */
function summariseFact(content: Prisma.JsonValue): string {
  if (!content || typeof content !== 'object') return String(content).slice(0, 200);
  const c = content as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.title === 'string') parts.push(c.title);
  if (typeof c.company === 'string') parts.push(`@${c.company}`);
  if (typeof c.school === 'string') parts.push(`school=${c.school}`);
  if (typeof c.degree === 'string') parts.push(c.degree);
  if (typeof c.name === 'string' && parts.length === 0) parts.push(c.name);
  if (typeof c.start === 'string' || typeof c.end === 'string') {
    parts.push(`${c.start ?? '?'}-${c.end ?? 'present'}`);
  }
  if (Array.isArray(c.bullets) && c.bullets.length > 0) {
    parts.push(`bullets=${(c.bullets as unknown[]).length}`);
  }
  return parts.join(' ').slice(0, 300) || JSON.stringify(content).slice(0, 300);
}
