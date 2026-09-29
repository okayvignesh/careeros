import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DeepSeekProvider,
  renderPrompt,
  runFactCheck,
  wrapUntrusted,
  type CitedFact,
  type FactCheckClaim,
  type OutreachDraft,
  type Sensitivity,
} from '@careeros/ai';
import {
  INDUSTRY_VARIANTS,
  OUTREACH_TEMPLATE_IDS,
  getOutreachTemplate,
  nextBusinessHourSlot,
  type IndustryVariant,
  type OutreachTemplateId,
} from '@careeros/shared';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { makeLlmAuditor } from '../../common/llm-audit';

const KEY = loadMasterKey();
const MAX_EVIDENCE_ROWS = 20;

export interface ComposeInput {
  userId: string;
  templateId: string;
  industryVariant?: string;
  applicationId?: string;
  recipient: {
    email: string;
    name?: string;
    role?: string;
    company?: string;
    timezone?: string; // for send-timing
    context?: string; // free-text signals (referrer notes, LinkedIn snippet, ...)
  };
}

export interface ComposeResult {
  ok: boolean;
  outreachMessageId: string | null;
  subject?: string;
  body?: string;
  sendAt?: string;
  reason?: string;
}

@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  async compose(input: ComposeInput): Promise<ComposeResult> {
    if (!OUTREACH_TEMPLATE_IDS.includes(input.templateId as OutreachTemplateId)) {
      throw new BadRequestException(`Unknown templateId: ${input.templateId}`);
    }
    const variant = (input.industryVariant ?? 'default') as IndustryVariant;
    if (!INDUSTRY_VARIANTS.includes(variant)) {
      throw new BadRequestException(`Unknown industryVariant: ${input.industryVariant}`);
    }
    if (!input.recipient?.email || !isValidEmail(input.recipient.email)) {
      throw new BadRequestException('recipient.email is required and must be a valid email');
    }

    const tpl = getOutreachTemplate(input.templateId);
    const provider = await this.loadProvider(input.userId);
    if (!provider) {
      throw new BadRequestException(
        'No AI provider configured. Configure one before composing outreach.',
      );
    }
    const evidence = await this.loadEvidence(input.userId);

    const rendered = renderPrompt('outreach-composer', {
      templateDisplayName: tpl.displayName,
      templateId: tpl.id,
      templateVersion: tpl.version,
      personaLine: tpl.personaLine,
      industryVariant: variant,
      variantHint: tpl.variantHints[variant],
      skeleton: tpl.skeleton.map((s, i) => `  ${i + 1}. ${s}`).join('\n'),
      recipientContext: wrapUntrusted(
        formatRecipientContext(input.recipient),
        'user-input',
      ).content,
      evidenceCatalog: renderEvidenceCatalog(evidence),
    });

    const raw = (await this.usage.runWithUserLimit(input.userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.5,
        maxTokens: 1100,
      }),
    )) as OutreachDraft;

    // Reject bogus factRefs before persisting.
    const validRefs = new Set(evidence.map((e) => e.id));
    const bogusRefs = raw.factRefs.filter((r) => !validRefs.has(r));
    if (bogusRefs.length > 0) {
      return {
        ok: false,
        outreachMessageId: null,
        reason: `draft cited unknown factIds: ${bogusRefs.join(',')}`,
      };
    }

    // Fact-check gate.
    const cited: CitedFact[] = evidence
      .filter((e) => raw.factRefs.includes(e.id))
      .map((e) => ({ id: e.id, kind: e.source, summary: e.content }));
    if (cited.length > 0) {
      const claim: FactCheckClaim = { index: 0, text: raw.body, cited };
      const outcome = await runFactCheck({
        claims: [claim],
        provider,
        runWithUserLimit: (fn) => this.usage.runWithUserLimit(input.userId, fn),
      }).catch((err) => {
        this.logger.warn(`outreach fact-check crashed: ${(err as Error).message}`);
        return null;
      });
      if (outcome && outcome.ok) {
        const verdict = outcome.verdicts.get(0);
        if (verdict && !verdict.supported) {
          return {
            ok: false,
            outreachMessageId: null,
            reason: `fact-check flagged the draft: ${verdict.reason}`,
          };
        }
      }
    }

    const sendAt = input.recipient.timezone
      ? nextBusinessHourSlot(input.recipient.timezone)
      : null;

    const row = await this.prisma.outreachMessage.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId ?? null,
        templateId: input.templateId,
        industryVariant: variant,
        recipientEmail: input.recipient.email.slice(0, 320),
        recipientName: input.recipient.name?.slice(0, 200) ?? null,
        recipientRole: input.recipient.role?.slice(0, 200) ?? null,
        subject: raw.subject,
        body: raw.body,
        factRefs: raw.factRefs,
        sendAt,
        status: 'draft',
      } as Prisma.OutreachMessageUncheckedCreateInput,
    });

    const result: ComposeResult = {
      ok: true,
      outreachMessageId: row.id,
      subject: row.subject,
      body: row.body,
    };
    if (sendAt) result.sendAt = sendAt.toISOString();
    return result;
  }

  async list(userId: string, status?: string) {
    return this.prisma.outreachMessage.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { generatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        applicationId: true,
        templateId: true,
        industryVariant: true,
        recipientEmail: true,
        recipientName: true,
        subject: true,
        body: true,
        status: true,
        sendAt: true,
        approvedAt: true,
        sentAt: true,
        generatedAt: true,
      },
    });
  }

  async approve(userId: string, id: string): Promise<void> {
    await this.transition(userId, id, 'draft', 'approved', { approvedAt: new Date() });
  }

  async markSent(userId: string, id: string, gmailDraftId?: string): Promise<void> {
    await this.transition(userId, id, 'approved', 'sent', {
      sentAt: new Date(),
      ...(gmailDraftId ? { gmailDraftId } : {}),
    });
  }

  async discard(userId: string, id: string): Promise<void> {
    const row = await this.prisma.outreachMessage.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('outreach message not found');
    if (row.status === 'sent') {
      throw new BadRequestException('cannot discard a sent message');
    }
    await this.prisma.outreachMessage.update({
      where: { id },
      data: { status: 'discarded' },
    });
  }

  private async transition(
    userId: string,
    id: string,
    from: string,
    to: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.prisma.outreachMessage.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('outreach message not found');
    if (row.status !== from) {
      throw new BadRequestException(`cannot transition ${row.status} -> ${to}`);
    }
    await this.prisma.outreachMessage.update({
      where: { id },
      data: { status: to, ...extra } as Prisma.OutreachMessageUpdateInput,
    });
  }

  private async loadEvidence(userId: string): Promise<Array<{ id: string; content: string; source: string }>> {
    const rows = await this.prisma.evidence.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_EVIDENCE_ROWS,
      select: { id: true, kind: true, detail: true, sourceRef: true },
    });
    return rows.map((r) => ({
      id: r.id,
      content: summariseEvidence(r.kind, r.detail, r.sourceRef),
      source: r.kind,
    }));
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
    await this.sensitivity.assertAllowed(cfg.provider, 'personal' as Sensitivity, userId);
    return new DeepSeekProvider({
      apiKey,
      baseUrl: cfg.baseUrl ?? undefined,
      chatModel: cfg.chatModel,
      onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
    });
  }
}

function summariseEvidence(kind: string, detail: unknown, sourceRef: unknown): string {
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

function renderEvidenceCatalog(rows: Array<{ id: string; content: string }>): string {
  if (rows.length === 0) return '(no evidence available)';
  return rows.map((r) => `- ${r.id}: ${r.content}`).join('\n');
}

function formatRecipientContext(r: ComposeInput['recipient']): string {
  const bits: string[] = [];
  if (r.name) bits.push(`name: ${r.name}`);
  if (r.role) bits.push(`role: ${r.role}`);
  if (r.company) bits.push(`company: ${r.company}`);
  if (r.context) bits.push(`notes: ${r.context}`);
  return bits.join('\n') || '(no recipient context provided)';
}

function isValidEmail(s: string): boolean {
  // ponytail: minimal email shape. RFC-strict validation is a rabbit hole
  // and the caller is user-typed input from the browser; downstream Gmail
  // API will reject an invalid address at send time.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
}
