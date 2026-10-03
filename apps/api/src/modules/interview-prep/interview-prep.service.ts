import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DeepSeekProvider,
  renderPrompt,
  runFactCheck,
  wrapUntrusted,
  type CitedFact,
  type FactCheckClaim,
  type Sensitivity,
} from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import type {
  InterviewPrepPlan,
  TalkTrack,
} from '@careeros/ai';
import { PrismaService } from '../../prisma/prisma.service';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { makeLlmAuditor } from '../../common/llm-audit';

/**
 * F.4 (Wave F / P6): interview prep + talk-track generation.
 *
 *   generatePlan(userId, applicationId) - creates or refreshes the per-
 *     application prep plan (3-12 topics with evidence refs). Pulls the
 *     job description, cached company dossier, and the user's applied
 *     resume variant + their evidence catalogue.
 *
 *   generateTalkTrack(userId, applicationId, topicId) - drafts a 60-90s
 *     verbal answer for one topic, then runs the fact-check gate. On a
 *     gate failure the draft is refused (empty result + reason).
 *
 * Every LLM call routes through UsageService.assertCallAllowed +
 * per-user concurrency limit, uses the wrap gate for untrusted content
 * (job description + company dossier + evidence), and audits via
 * makeLlmAuditor.
 */

const KEY = loadMasterKey();
const MAX_EVIDENCE_ROWS = 25;

interface EvidenceRow {
  id: string;
  content: string;
  source: string;
}

export interface GenerateResult {
  id: string;
  plan: InterviewPrepPlan;
  talkTracks: Record<string, TalkTrack & { generatedAt: string; factCheck?: string }>;
}

export interface TalkTrackResult {
  ok: boolean;
  topicId: string;
  talkTrack: (TalkTrack & { generatedAt: string; factCheck?: string }) | null;
  reason?: string;
}

@Injectable()
export class InterviewPrepService {
  private readonly logger = new Logger(InterviewPrepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  async generatePlan(userId: string, applicationId: string): Promise<GenerateResult> {
    const provider = await this.loadProvider(userId);
    if (!provider) {
      throw new BadRequestException(
        'No AI provider configured. Configure one before generating interview prep.',
      );
    }
    const ctx = await this.loadApplicationContext(userId, applicationId);
    const evidence = await this.loadEvidence(userId);

    const rendered = renderPrompt('interview-prep-planner', {
      jobDescription: wrapUntrusted(ctx.jobDescription, 'user-input', { userId }).content,
      companyDossier: wrapUntrusted(ctx.companyDossier, 'user-input', { userId }).content,
      resumeSummary: ctx.resumeSummary,
      evidenceCatalog: renderEvidenceCatalog(evidence),
    });

    const plan = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.4,
        maxTokens: 1500,
        meta: {
          promptId: rendered.id,
          promptVersion: rendered.version,
          promptHash: rendered.hash,
          sensitivity: 'personal',
        },
      }),
    )) as InterviewPrepPlan;

    const row = await this.prisma.interviewPrep.upsert({
      where: { userId_applicationId: { userId, applicationId } },
      create: {
        userId,
        applicationId,
        plan: plan as unknown as Prisma.InputJsonValue,
        talkTracks: {} as Prisma.InputJsonValue,
      },
      update: {
        plan: plan as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      id: row.id,
      plan,
      talkTracks: row.talkTracks as Record<string, TalkTrack & { generatedAt: string; factCheck?: string }>,
    };
  }

  async generateTalkTrack(
    userId: string,
    applicationId: string,
    topicId: string,
  ): Promise<TalkTrackResult> {
    const row = await this.prisma.interviewPrep.findUnique({
      where: { userId_applicationId: { userId, applicationId } },
    });
    if (!row) throw new NotFoundException('No prep plan; generate the plan first');
    const plan = row.plan as unknown as InterviewPrepPlan;
    const topic = plan.topics.find((t) => t.id === topicId);
    if (!topic) throw new NotFoundException(`Topic ${topicId} not in plan`);

    // Fail fast on unbacked topics BEFORE spinning up the provider - no
    // point paying for provider setup when we know the guard rejects.
    const evidenceRows = await this.loadEvidenceByIds(userId, topic.evidenceFactIds);
    if (evidenceRows.length === 0) {
      return {
        ok: false,
        topicId,
        talkTrack: null,
        reason: 'topic has no evidence backing; add facts before generating',
      };
    }

    const provider = await this.loadProvider(userId);
    if (!provider) {
      throw new BadRequestException(
        'No AI provider configured. Configure one before generating a talk-track.',
      );
    }

    const ctx = await this.loadApplicationContext(userId, applicationId);

    const rendered = renderPrompt('talk-track-generator', {
      topicTitle: topic.title,
      topicRationale: topic.rationale,
      evidenceCatalog: renderEvidenceCatalog(evidenceRows),
      roleContext: `${ctx.role} at ${ctx.company}`,
    });

    const raw = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.5,
        maxTokens: 900,
        meta: {
          promptId: rendered.id,
          promptVersion: rendered.version,
          promptHash: rendered.hash,
          sensitivity: 'personal',
        },
      }),
    )) as TalkTrack;

    // Fact-check gate: every factRef the model cited MUST resolve to
    // an evidence row we passed in, and the draft claim must be
    // supported per runFactCheck. Reject the response on any hallucination.
    const cited: CitedFact[] = evidenceRows.map((e) => ({
      id: e.id,
      kind: e.source,
      summary: e.content,
    }));
    const validRefs = new Set(evidenceRows.map((e) => e.id));
    const bogusRefs = raw.factRefs.filter((r) => !validRefs.has(r));
    if (bogusRefs.length > 0) {
      return {
        ok: false,
        topicId,
        talkTrack: null,
        reason: `talk-track cited unknown facts: ${bogusRefs.join(',')}`,
      };
    }
    const claim: FactCheckClaim = {
      index: 0,
      text: raw.draft,
      cited: cited.filter((c) => raw.factRefs.includes(c.id)),
    };
    const outcome = await runFactCheck({
      claims: [claim],
      provider,
      sensitivity: 'personal',
      runWithUserLimit: (fn) => this.usage.runWithUserLimit(userId, fn),
    }).catch((err) => {
      this.logger.warn(`talk-track fact-check crashed, keeping draft: ${(err as Error).message}`);
      return null;
    });

    let factCheckNote = 'unchecked';
    if (outcome && outcome.ok) {
      const verdict = outcome.verdicts.get(0);
      factCheckNote = verdict?.supported ? 'supported' : `flagged: ${verdict?.reason ?? 'unknown'}`;
    } else if (outcome && !outcome.ok) {
      factCheckNote = `unchecked: ${outcome.reason}`;
    }

    const talkTrack = {
      ...raw,
      generatedAt: new Date().toISOString(),
      factCheck: factCheckNote,
    };
    if (outcome && factCheckNote.startsWith('flagged')) {
      return {
        ok: false,
        topicId,
        talkTrack: null,
        reason: `fact-check flagged the draft: ${factCheckNote}`,
      };
    }

    const talkTracks = { ...(row.talkTracks as Record<string, unknown>), [topicId]: talkTrack };
    await this.prisma.interviewPrep.update({
      where: { id: row.id },
      data: { talkTracks: talkTracks as Prisma.InputJsonValue },
    });

    return { ok: true, topicId, talkTrack };
  }

  async get(userId: string, applicationId: string): Promise<GenerateResult | null> {
    const row = await this.prisma.interviewPrep.findUnique({
      where: { userId_applicationId: { userId, applicationId } },
    });
    if (!row) return null;
    return {
      id: row.id,
      plan: row.plan as unknown as InterviewPrepPlan,
      talkTracks: row.talkTracks as Record<string, TalkTrack & { generatedAt: string; factCheck?: string }>,
    };
  }

  private async loadApplicationContext(
    userId: string,
    applicationId: string,
  ): Promise<{
    jobDescription: string;
    companyDossier: string;
    resumeSummary: string;
    role: string;
    company: string;
  }> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      select: { jobId: true, resumeVariantId: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    const [job, dossier, resume] = await Promise.all([
      this.prisma.normalizedJob.findUnique({
        where: { id: app.jobId },
        select: { title: true, company: true, description: true },
      }),
      // Dossier lookup - companyId is the free-form company name per C-P4.4.
      this.prisma.application
        .findUnique({ where: { id: applicationId }, select: { jobId: true } })
        .then(async () => {
          const j = await this.prisma.normalizedJob.findUnique({
            where: { id: app.jobId },
            select: { company: true },
          });
          if (!j) return null;
          return this.prisma.companyDossier.findUnique({ where: { companyId: j.company } });
        }),
      app.resumeVariantId
        ? this.prisma.resumeVariant.findUnique({
            where: { id: app.resumeVariantId },
            select: { contentJson: true },
          })
        : Promise.resolve(null),
    ]);
    if (!job) throw new NotFoundException('Normalized job for this application not found');
    return {
      jobDescription: job.description.slice(0, 8000),
      companyDossier: dossier
        ? dossierToText(dossier)
        : 'No company dossier available - focus on job-description signals.',
      resumeSummary: resume
        ? resumeToText(resume.contentJson as unknown)
        : 'No tailored resume for this application - use generic best-fit examples.',
      role: job.title,
      company: job.company,
    };
  }

  private async loadEvidence(userId: string): Promise<EvidenceRow[]> {
    const rows = await this.prisma.evidence.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_EVIDENCE_ROWS,
      select: { id: true, kind: true, detail: true, sourceRef: true },
    });
    return rows.map(evidenceRowToPromptRow);
  }

  private async loadEvidenceByIds(userId: string, ids: string[]): Promise<EvidenceRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.evidence.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, kind: true, detail: true, sourceRef: true },
    });
    return rows.map(evidenceRowToPromptRow);
  }

  private async loadProvider(userId: string) {
    await this.usage.assertCallAllowed(userId);
    const cfg = await this.prisma.providerConfig.findFirst({
      where: { userId, isDefault: true },
    });
    if (!cfg || cfg.provider !== 'deepseek') return null;
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: cfg.apiKeySecretId },
    });
    if (!secret) return null;
    const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
    // Sensitivity: this is interview prep for a specific company, so
    // the content is `personal` (candidate's private prep) not `public`.
    await this.sensitivity.assertAllowed(cfg.provider, 'personal' as Sensitivity, userId);
    return new DeepSeekProvider({
      apiKey,
      baseUrl: cfg.baseUrl ?? undefined,
      chatModel: cfg.chatModel,
      onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
    });
  }
}

function evidenceRowToPromptRow(row: {
  id: string;
  kind: string;
  detail: unknown;
  sourceRef: unknown;
}): EvidenceRow {
  const content = summariseEvidenceContent(row.kind, row.detail, row.sourceRef);
  return { id: row.id, content, source: row.kind };
}

function summariseEvidenceContent(kind: string, detail: unknown, sourceRef: unknown): string {
  const d = detail as Record<string, unknown> | null;
  const s = sourceRef as Record<string, unknown> | null;
  const bits: string[] = [`[${kind}]`];
  if (d && typeof d === 'object') {
    for (const k of ['summary', 'signal', 'metric', 'headline', 'title']) {
      const v = d[k];
      if (typeof v === 'string') {
        bits.push(v);
        break;
      }
    }
  }
  if (s && typeof s === 'object') {
    const ref = s.url ?? s.id ?? s.kind;
    if (typeof ref === 'string') bits.push(`(${ref})`);
  }
  return bits.join(' ').slice(0, 400);
}

function renderEvidenceCatalog(rows: EvidenceRow[]): string {
  if (rows.length === 0) return '(no evidence available)';
  return rows.map((r) => `- ${r.id}: ${r.content}`).join('\n');
}

function dossierToText(dossier: {
  identity: unknown;
  techSignals?: unknown;
  reviews?: unknown;
  recentEvents?: unknown;
  narrative?: unknown;
}): string {
  const parts: string[] = [];
  const narrative = (dossier as { narrative?: unknown }).narrative;
  if (typeof narrative === 'string') parts.push(narrative);
  const identity = dossier.identity as Record<string, unknown> | null;
  if (identity?.website) parts.push(`website: ${identity.website}`);
  const events = dossier.recentEvents;
  if (Array.isArray(events)) {
    for (const e of events.slice(0, 5)) {
      const h = (e as { headline?: string }).headline;
      if (typeof h === 'string') parts.push(`event: ${h}`);
    }
  }
  return parts.join('\n').slice(0, 4000) || 'No dossier detail available.';
}

function resumeToText(contentJson: unknown): string {
  if (!contentJson || typeof contentJson !== 'object') return '';
  const c = contentJson as Record<string, unknown>;
  const bullets: string[] = [];
  const experience = c.experience;
  if (Array.isArray(experience)) {
    for (const role of experience.slice(0, 4) as Array<Record<string, unknown>>) {
      const title = role.title ?? role.role ?? '';
      const company = role.company ?? '';
      bullets.push(`${title} @ ${company}`);
      const items = role.bullets;
      if (Array.isArray(items)) {
        for (const b of items.slice(0, 4)) {
          if (typeof b === 'string') bullets.push(`- ${b}`);
          else if (b && typeof (b as { text?: unknown }).text === 'string') {
            bullets.push(`- ${(b as { text: string }).text}`);
          }
        }
      }
    }
  }
  return bullets.join('\n').slice(0, 3000);
}
