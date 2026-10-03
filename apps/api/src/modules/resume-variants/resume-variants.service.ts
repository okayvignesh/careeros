import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TailoredResumeContent } from '@careeros/shared';
import { renderResumePdf } from '@careeros/resume-render';
import {
  renderPrompt,
  runFactCheck,
  wrapUntrusted,
  type AIProvider,
  type FactCheckClaim,
} from '@careeros/ai';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ProviderLoaderService } from '../../common/provider-loader.service';

export interface FactRefInfo {
  id: string;
  kind: string;
  summary: string;
}

export interface DroppedBullet {
  section: string;
  text: string;
  reason: string;
}

export type AuditStatus = 'passed' | 'partial' | 'unchecked';

export interface FactCheckAudit {
  status: AuditStatus;
  bulletsChecked: number;
  bulletsPassed: number;
  bulletsDropped: number;
  dropped: DroppedBullet[];
}

export interface ResumeVariantDto {
  id: string;
  jobId: string | null;
  jobTitle: string | null;
  jobCompany: string | null;
  roleTarget: string;
  templateId: string;
  content: TailoredResumeContent;
  factRefs: FactRefInfo[];
  audit: FactCheckAudit;
  createdAt: string;
}

@Injectable()
export class ResumeVariantsService {
  private readonly logger = new Logger(ResumeVariantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly providerLoader: ProviderLoaderService,
  ) {}

  async listForUser(userId: string): Promise<Array<Omit<ResumeVariantDto, 'content' | 'factRefs' | 'audit'>>> {
    const rows = await this.prisma.resumeVariant.findMany({
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

  async getById(userId: string, id: string): Promise<ResumeVariantDto> {
    const row = await this.prisma.resumeVariant.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Resume variant not found');
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

  async generateForJob(userId: string, jobId: string): Promise<ResumeVariantDto> {
    const job = await this.prisma.normalizedJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const facts = await this.prisma.resumeFact.findMany({
      where: { userId, verified: true },
      orderBy: { createdAt: 'asc' },
    });
    if (facts.length === 0) {
      throw new BadRequestException(
        'No verified resume facts. Add facts on /facts (or re-run resume ingest) first.',
      );
    }

    const provenSkills = await this.prisma.candidateSkillState.findMany({
      where: { userId, historicalDemonstrated: true },
      select: { skillId: true },
    });
    const skillList = provenSkills.map((s) => s.skillId).join(', ') || '(none tracked yet)';

    const provider = await this.tryLoadProvider(userId);
    if (!provider) {
      throw new BadRequestException(
        'LLM provider not configured or paused; resume generation needs an LLM.',
      );
    }

    // Numbered fact list — LLM cites `factRefs` by the fact.id verbatim.
    const factsRendered = facts
      .map((f) => `- id=${f.id} kind=${f.kind} ${summariseFact(f.content)}`)
      .join('\n');

    // Job description is untrusted (third-party listing).
    const descWrapped = wrapUntrusted(job.description, 'job-description');
    const rendered = renderPrompt('tailored-resume-writer', {
      jobTitle: job.title,
      jobCompany: job.company,
      jobDescription: descWrapped.content,
      facts: factsRendered,
      candidateSkills: skillList,
    });
    // A-M9: per-user LLM concurrency ceiling.
    const raw = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.2,
      }),
    )) as TailoredResumeContent;

    // Hallucination guard: drop cited fact IDs that aren't in our list, drop
    // bullets that end up with zero valid refs (except summary — that's
    // whole-resume framing, not a factual claim).
    const knownIds = new Set(facts.map((f) => f.id));
    const cleanedSections = raw.sections
      .map((sec) => ({
        heading: sec.heading,
        bullets: sec.bullets
          .map((b) => ({
            text: b.text,
            factRefs: b.factRefs.filter((id) => knownIds.has(id)),
          }))
          .filter((b) => b.factRefs.length > 0),
      }))
      .filter((sec) => sec.bullets.length > 0);

    if (cleanedSections.length === 0) {
      throw new BadRequestException(
        'LLM produced no bullets grounded in your verified facts. Try adding more facts and re-generate.',
      );
    }

    // Fact-check pass: verify the bullet TEXT is actually supported by the
    // cited fact content (upstream only checked that citations are legit IDs).
    // On failure we mark the audit as `unchecked` and keep bullets — better
    // to ship an un-audited draft than to lose the generation entirely.
    const factById = new Map(facts.map((f) => [f.id, f]));
    const { finalSections, audit } = await this.runFactCheck(
      userId,
      provider,
      cleanedSections,
      factById,
    );

    if (finalSections.length === 0) {
      throw new BadRequestException(
        'Fact-check dropped every bullet. The LLM likely fabricated claims beyond your verified facts. Try adding more detail to your facts.',
      );
    }

    const finalContent: TailoredResumeContent = { summary: raw.summary, sections: finalSections };
    const allRefs = Array.from(
      new Set(finalSections.flatMap((sec) => sec.bullets.flatMap((b) => b.factRefs))),
    );

    // Store {content, audit} wrapper so historical variants can be re-audited
    // and the UI can surface what was dropped without re-running the check.
    const persistPayload = { content: finalContent, audit };

    const row = await this.prisma.resumeVariant.create({
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

  /**
   * Batched fact-check: one LLM call for the whole variant. Each bullet gets
   * a flat index, cited fact contents are attached inline, and the LLM
   * returns per-index supported+reason. Unsupported bullets are dropped.
   * If the check itself fails, the variant is marked `unchecked` — user gets
   * a draft they can trust less, not no draft at all.
   *
   * The LLM round-trip lives in `@careeros/ai::runFactCheck` (C-P4.7a); this
   * method owns the resume-specific flatten + drop + audit shape.
   */
  private async runFactCheck(
    userId: string,
    provider: AIProvider,
    sections: TailoredResumeContent['sections'],
    factById: Map<string, { id: string; kind: string; content: Prisma.JsonValue }>,
  ): Promise<{ finalSections: TailoredResumeContent['sections']; audit: FactCheckAudit }> {
    // Flatten bullets with (section, index) breadcrumbs.
    const flat: Array<{
      idx: number;
      section: string;
      text: string;
      factRefs: string[];
    }> = [];
    let i = 0;
    for (const sec of sections) {
      for (const b of sec.bullets) {
        flat.push({ idx: i++, section: sec.heading, text: b.text, factRefs: b.factRefs });
      }
    }
    if (flat.length === 0) {
      return {
        finalSections: sections,
        audit: { status: 'passed', bulletsChecked: 0, bulletsPassed: 0, bulletsDropped: 0, dropped: [] },
      };
    }

    // Shape claims for the shared gate. `summariseFact` stays here (domain
    // knowledge of the ResumeFact JSON shape).
    const claims: FactCheckClaim[] = flat.map((b) => ({
      index: b.idx,
      text: b.text,
      cited: b.factRefs.map((id) => {
        const f = factById.get(id);
        return f
          ? { id: f.id, kind: f.kind, summary: summariseFact(f.content) }
          : { id, kind: 'missing', summary: '(MISSING)' };
      }),
    }));

    // A-M9: per-user LLM concurrency ceiling passed through the shared gate.
    const outcome = await runFactCheck({
      provider,
      claims,
      runWithUserLimit: (fn) => this.usage.runWithUserLimit(userId, fn),
    });

    if (!outcome.ok) {
      // Fact-check failed — keep everything, mark audit unchecked.
      this.logger.warn(`fact-check pass failed, marking variant unchecked: ${outcome.reason}`);
      return {
        finalSections: sections,
        audit: {
          status: 'unchecked',
          bulletsChecked: 0,
          bulletsPassed: flat.length,
          bulletsDropped: 0,
          dropped: [],
        },
      };
    }

    const verdicts = outcome.verdicts;
    // Iterate positionally (matches `flat` order) instead of .find-by-text so
    // duplicate bullet text within a section doesn't collide onto one flat entry.
    const dropped: DroppedBullet[] = [];
    let passed = 0;
    let cursor = 0;
    const finalSections = sections
      .map((sec) => ({
        heading: sec.heading,
        bullets: sec.bullets.filter((b) => {
          const idx = cursor++;
          const v = verdicts.get(idx);
          // Missing verdict = DROP. Trust-critical gate: "when in doubt, keep"
          // launders LLM omissions into false-green audits. If the auditor
          // didn't score a bullet, we don't ship it.
          if (!v) {
            dropped.push({ section: sec.heading, text: b.text, reason: 'no verdict returned by fact-check' });
            return false;
          }
          if (v.supported) {
            passed++;
            return true;
          }
          dropped.push({ section: sec.heading, text: b.text, reason: v.reason });
          return false;
        }),
      }))
      .filter((sec) => sec.bullets.length > 0);

    const bulletsChecked = flat.length;
    const bulletsDropped = dropped.length;
    const status: AuditStatus = bulletsDropped === 0 ? 'passed' : 'partial';
    // Also emit an audit_log row per drop for cross-service uniformity
    // (C-P4.7 spec: `factcheck.claim.dropped { service, claim, reason }`).
    for (const d of dropped) {
      await this.auditDropped(userId, d.text, d.reason);
    }
    return {
      finalSections,
      audit: { status, bulletsChecked, bulletsPassed: passed, bulletsDropped, dropped },
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
          resourceType: 'resume_variant',
          resourceId: userId,
          payload: { service: 'resume-variants', claim, reason },
        },
      });
    } catch {
      /* audit must not throw (also silent when the test fake omits auditEvent) */
    }
  }

  /** Render the variant as PDF via `@careeros/resume-render`. */
  async renderPdf(userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const variant = await this.getById(userId, id);
    const buffer = await renderResumePdf({
      roleTarget: variant.roleTarget,
      jobCompany: variant.jobCompany,
      content: variant.content,
    });
    const safeCompany = (variant.jobCompany ?? 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return { buffer, filename: `resume-${safeCompany}-${variant.id.slice(0, 8)}.pdf` };
  }

  private async loadFactRefs(userId: string, ids: string[]): Promise<FactRefInfo[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.resumeFact.findMany({
      where: { userId, id: { in: ids } },
    });
    return rows.map((f) => ({
      id: f.id,
      kind: f.kind,
      summary: summariseFact(f.content),
    }));
  }

  private async tryLoadProvider(userId: string): Promise<AIProvider | null> {
    try {
      // Resume facts + job description together are `personal` — the candidate's
      // work history alongside third-party listing prose. Gate accordingly.
      const loaded = await this.providerLoader.loadProviderForUser(userId, 'personal');
      return loaded?.provider ?? null;
    } catch (err) {
      this.logger.warn(`resume-variants: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * Read `resume_variants.contentJson` handling both the slice-20 wrapper shape
 * `{content, audit}` and the legacy slice-19 shape (bare `TailoredResumeContent`).
 * Legacy rows report `audit.status='unchecked'` so the UI marks them honestly
 * rather than pretending they were audited.
 */
function unwrapContentJson(
  raw: Prisma.JsonValue,
): { content: TailoredResumeContent; audit: FactCheckAudit } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj && 'content' in obj && 'audit' in obj) {
    return {
      content: obj.content as unknown as TailoredResumeContent,
      audit: obj.audit as unknown as FactCheckAudit,
    };
  }
  return {
    content: raw as unknown as TailoredResumeContent,
    audit: { status: 'unchecked', bulletsChecked: 0, bulletsPassed: 0, bulletsDropped: 0, dropped: [] },
  };
}

/**
 * Compact one-line summary of a resume fact for prompt injection. Different
 * fact kinds have different shapes; we pull the most identifying fields and
 * cap length so a fat employment record doesn't dominate the context.
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
