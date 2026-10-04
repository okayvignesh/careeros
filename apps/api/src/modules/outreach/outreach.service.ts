import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue, type ConnectionOptions } from 'bullmq';
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
import {
  ApprovalsService,
  type ApprovalItemDto,
  type ApprovalsWorker,
} from '../approvals/approvals.service';
import type { ApprovalKind } from '../approvals/state-machine';
import { GmailOutboundService } from '../gmail/gmail.outbound.service';
import {
  JOB_OUTREACH_SEND,
  QUEUE_OUTREACH_SEND,
  outreachSendJobId,
  type OutreachSendPayload,
} from './outreach.queue';

const KEY = loadMasterKey();
const MAX_EVIDENCE_ROWS = 20;
export const OUTREACH_APPROVAL_KIND: ApprovalKind = 'outreach_email';

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
export class OutreachService implements OnModuleInit, ApprovalsWorker {
  private readonly logger = new Logger(OutreachService.name);
  private sendQueue: Queue | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly approvals: ApprovalsService,
    private readonly gmail: GmailOutboundService,
  ) {}

  /** Register with the F.1 approval queue as the `outreach_email` executor. */
  onModuleInit(): void {
    this.approvals.registerWorker(this);
  }

  handles(kind: ApprovalKind): boolean {
    return kind === OUTREACH_APPROVAL_KIND;
  }

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
        { userId: input.userId },
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
        meta: {
          promptId: rendered.id,
          promptVersion: rendered.version,
          promptHash: rendered.hash,
          sensitivity: 'personal',
        },
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
        sensitivity: 'personal',
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
        gmailDraftId: true,
        replyMessageId: true,
        generatedAt: true,
      },
    });
  }

  async getById(userId: string, id: string) {
    const row = await this.prisma.outreachMessage.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('outreach message not found');
    return row;
  }

  /**
   * Enqueue an `outreach_email` approval item. Rule #3: the message is not
   * sent (nor even staged in Gmail) until a user approves the queued item.
   * Idempotent: a second call while an item is still pending returns it.
   */
  async requestApproval(userId: string, id: string): Promise<ApprovalItemDto> {
    const row = await this.prisma.outreachMessage.findFirst({
      where: { id, userId },
      select: { id: true, status: true, subject: true, body: true, recipientEmail: true, sendAt: true },
    });
    if (!row) throw new NotFoundException('outreach message not found');
    if (row.status !== 'draft') {
      throw new BadRequestException(`cannot request approval for a ${row.status} message`);
    }
    const existing = await this.prisma.approvalItem.findFirst({
      where: {
        userId,
        kind: OUTREACH_APPROVAL_KIND,
        state: 'pending',
        payload: { path: ['outreachMessageId'], equals: id },
      },
    });
    if (existing) return existing as unknown as ApprovalItemDto;

    const item = await this.approvals.enqueue({
      userId,
      kind: OUTREACH_APPROVAL_KIND,
      payload: { userId, outreachMessageId: id } satisfies OutreachApprovalPayload,
      diffJson: {
        to: row.recipientEmail,
        subject: row.subject,
        body: row.body,
        sendAt: row.sendAt?.toISOString() ?? null,
      },
    });
    await this.audit(userId, 'outreach.approval.requested', id, {
      approvalItemId: item.id,
    });
    return item;
  }

  /**
   * ApprovalsWorker callback: the user approved. Stage the message as a Gmail
   * draft (never a direct send), record `gmailDraftId`, and schedule the
   * business-hour send job when the composer picked a slot. Idempotent on
   * retry via the existing `gmailDraftId`.
   */
  async onApproved(item: ApprovalItemDto): Promise<void> {
    const payload = parseOutreachApprovalPayload(item.payload);
    if (!payload) {
      await this.approvals.markFailed({ itemId: item.id, reason: 'invalid outreach payload' });
      return;
    }
    const userId = payload.userId;
    const row = await this.prisma.outreachMessage.findFirst({
      where: { id: payload.outreachMessageId, userId },
    });
    if (!row) {
      await this.approvals.markFailed({ itemId: item.id, reason: 'outreach message not found' });
      return;
    }
    if (row.gmailDraftId) {
      await this.approvals.markSent({
        itemId: item.id,
        meta: { gmailDraftId: row.gmailDraftId, idempotent: true },
      });
      return;
    }
    try {
      const draft = await this.gmail.createDraft(userId, {
        to: row.recipientEmail,
        subject: row.subject,
        body: row.body,
        idempotencyKey: `outreach:${row.id}`,
        linkOutreachMessageId: row.id,
      });
      await this.prisma.outreachMessage.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          approvedAt: row.approvedAt ?? new Date(),
          gmailDraftId: draft.draftId,
        },
      });
      await this.audit(userId, 'outreach.approval.draft_created', row.id, {
        approvalItemId: item.id,
        gmailDraftId: draft.draftId,
        threadId: draft.threadId,
      });
      await this.approvals.markSent({
        itemId: item.id,
        meta: { gmailDraftId: draft.draftId, outreachMessageId: row.id },
      });
      await this.scheduleSendIfDue(userId, row.id, row.sendAt);
    } catch (err) {
      const reason = (err as Error).message ?? 'gmail draft failed';
      await this.audit(userId, 'outreach.approval.draft_failed', row.id, {
        approvalItemId: item.id,
        reason,
      });
      await this.approvals.markFailed({ itemId: item.id, reason });
    }
  }

  /**
   * Send the staged Gmail draft (the user's explicit "send now", or the
   * worker's due-send). Idempotent: an already-sent row returns its recorded
   * result instead of sending twice.
   */
  async send(userId: string, id: string): Promise<OutreachSendResult> {
    const row = await this.prisma.outreachMessage.findFirst({
      where: { id, userId },
      select: { id: true, status: true, gmailDraftId: true, replyMessageId: true, recipientEmail: true },
    });
    if (!row) throw new NotFoundException('outreach message not found');
    if (row.status === 'sent') {
      return { ok: true, alreadySent: true };
    }
    if (!row.gmailDraftId) {
      throw new BadRequestException('message has no Gmail draft; approve it first');
    }
    const res = await this.gmail.sendDraft(userId, row.gmailDraftId, {
      recipient: row.recipientEmail,
      outreachMessageId: row.id,
    });
    await this.prisma.outreachMessage.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    await this.audit(userId, 'outreach.sent', row.id, {
      gmailMessageId: res.messageId,
      threadId: res.threadId,
    });
    const out: OutreachSendResult = { ok: true, messageId: res.messageId };
    if (res.threadId) out.threadId = res.threadId;
    return out;
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
    // Cancel any still-pending approval so the queue cannot stage it later.
    const pending = await this.prisma.approvalItem.findMany({
      where: {
        userId,
        kind: OUTREACH_APPROVAL_KIND,
        state: 'pending',
        payload: { path: ['outreachMessageId'], equals: id },
      },
      select: { id: true },
    });
    for (const item of pending) {
      await this.approvals.cancel({ userId, itemId: item.id, reason: 'outreach discarded' });
    }
    await this.prisma.outreachMessage.update({ where: { id }, data: { status: 'discarded' } });
    await this.audit(userId, 'outreach.discarded', id, {});
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Refresh the delayed send job when the composer picked a future slot. If
   * `sendAt` is null (no recipient timezone), we deliberately do not schedule:
   * the user reviews the draft in Gmail and sends it themselves.
   */
  private async scheduleSendIfDue(
    userId: string,
    outreachMessageId: string,
    sendAt: Date | null,
  ): Promise<void> {
    if (!sendAt) return;
    const delay = sendAt.getTime() - Date.now();
    if (delay <= 0) return;
    const payload: OutreachSendPayload = { userId, outreachMessageId };
    try {
      await this.getSendQueue().add(JOB_OUTREACH_SEND, payload, {
        jobId: outreachSendJobId(outreachMessageId),
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });
    } catch (err) {
      // Scheduling is best-effort; the user can still send manually.
      this.logger.warn(`outreach send schedule failed: ${(err as Error).message}`);
    }
  }

  /** Lazily construct the producer so read/approve paths never touch Redis. */
  private getSendQueue(): Queue {
    if (!this.sendQueue) {
      const connection: ConnectionOptions = {
        url: process.env.REDIS_URL ?? 'redis://redis:6379',
      };
      this.sendQueue = new Queue(QUEUE_OUTREACH_SEND, { connection });
    }
    return this.sendQueue;
  }

  private async audit(
    userId: string,
    action: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action,
          resourceType: 'outreach_message',
          resourceId,
          payload: payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
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

/** Payload stored on `approval_items.payload` for `outreach_email`. */
export interface OutreachApprovalPayload {
  userId: string;
  outreachMessageId: string;
}

export interface OutreachSendResult {
  ok: boolean;
  messageId?: string;
  threadId?: string;
  alreadySent?: boolean;
}

/** Narrow unknown approval payload JSON; null when the shape is wrong. */
export function parseOutreachApprovalPayload(raw: unknown): OutreachApprovalPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string' || typeof r.outreachMessageId !== 'string') return null;
  return { userId: r.userId, outreachMessageId: r.outreachMessageId };
}
