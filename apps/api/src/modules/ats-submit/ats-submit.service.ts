import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { retry } from '@careeros/shared';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { renderResumePdfByTemplate, type ResumeContact } from '@careeros/resume-render';
import { isEligibleToApply } from '@careeros/job-pipeline';
import type { TailoredResumeContent } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService, type ApprovalItemDto, type ApprovalsWorker } from '../approvals/approvals.service';
import type { ApprovalKind } from '../approvals/state-machine';
import { AshbyAdapter } from './adapters/ashby.adapter';
import { GreenhouseAdapter } from './adapters/greenhouse.adapter';
import type {
  AtsCredentials,
  AtsSubmitAdapter,
  SubmitPayload,
  SubmitResult,
} from './adapters/types';

/**
 * F.2 orchestrator.
 *
 * Flow:
 *   1. Load the Application + the user's resume + candidate profile.
 *   2. Derive an idempotency key from (userId, applicationId, resumeHash)
 *      so re-submits of the exact same application + resume collapse
 *      into the same ats_submissions row.
 *   3. Upsert ats_submissions row with status=pending.
 *   4. Resolve the integration credentials from encrypted_secrets.
 *   5. Call adapter.submit() through the retry wrapper. The wrapper
 *      only retries when the adapter marks the failure as retryable
 *      (429 + 5xx + network).
 *   6. On success: update row to submitted + stamp application state to
 *      'applied'. On failure: update row to failed with last_error.
 *   7. Audit everything.
 *
 * ponytail: no BullMQ queue here - the HTTP endpoint drives the
 * submission synchronously because the user is clicking "submit" in
 * the UI and wants to see the confirmation. If submissions ever need
 * to batch, swap this for a queue consumer; the service contract is
 * already queue-friendly (idempotent + stateless).
 */

const KEY = loadMasterKey();

export type AtsId = 'ashby' | 'greenhouse';

export interface SubmitInput {
  userId: string;
  applicationId: string;
  ats: AtsId;
  /** Vendor-side job identifier (jobPostingId for Ashby, job_id for Greenhouse). */
  jobBoardId: string;
  /** Optional override; if absent we derive from (applicationId + resumeHash). */
  idempotencyKey?: string;
  /**
   * ID of the approvals row that gated this submit. The controller sets this
   * when the ApprovalsService dispatches an approved item. Direct callers
   * (none today) MUST enqueue via `enqueue()` first.
   */
  approvalItemId?: string;
}

/** `kind` value used for F.2 approval items. */
export const ATS_SUBMIT_APPROVAL_KIND: ApprovalKind = 'ats_submit';

/**
 * Shape of the payload stored on `approval_items.payload` for `ats_submit`.
 * Keep this literal: this is what the UI diff-preview reads and what
 * `onApproved` deserializes.
 */
export interface AtsSubmitApprovalPayload {
  userId: string;
  applicationId: string;
  ats: AtsId;
  jobBoardId: string;
  idempotencyKey?: string;
}

@Injectable()
export class AtsSubmitService implements OnModuleInit, ApprovalsWorker {
  private readonly logger = new Logger(AtsSubmitService.name);
  private readonly adapters: Record<AtsId, AtsSubmitAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {
    this.adapters = {
      ashby: new AshbyAdapter(),
      greenhouse: new GreenhouseAdapter(),
    };
  }

  /**
   * Register as the ApprovalsWorker for `ats_submit`. Dispatch is
   * fire-and-forget on the ApprovalsService side; onApproved reports its
   * terminal state back via markSent/markFailed.
   */
  onModuleInit(): void {
    this.approvals.registerWorker(this);
  }

  handles(kind: ApprovalKind): boolean {
    return kind === ATS_SUBMIT_APPROVAL_KIND;
  }

  async onApproved(item: ApprovalItemDto): Promise<void> {
    const payload = parseApprovalPayload(item.payload);
    if (!payload) {
      await this.approvals.markFailed({ itemId: item.id, reason: 'invalid payload' });
      return;
    }
    const input: SubmitInput = {
      userId: payload.userId,
      applicationId: payload.applicationId,
      ats: payload.ats,
      jobBoardId: payload.jobBoardId,
      approvalItemId: item.id,
      ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    };
    try {
      const result = await this.submit(input);
      if (result.status === 'submitted') {
        await this.approvals.markSent({
          itemId: item.id,
          meta: {
            submissionId: result.submissionId,
            ...(result.atsApplicationId ? { atsApplicationId: result.atsApplicationId } : {}),
          },
        });
      } else {
        await this.approvals.markFailed({
          itemId: item.id,
          reason: result.reason ?? 'submit failed',
        });
      }
    } catch (err) {
      await this.approvals.markFailed({
        itemId: item.id,
        reason: (err as Error).message ?? 'exception',
      });
    }
  }

  /**
   * Enqueue an approval item for this submit. The controller calls this;
   * the actual ATS POST runs later from onApproved() once the user approves.
   */
  async enqueue(input: Omit<SubmitInput, 'approvalItemId'>): Promise<ApprovalItemDto> {
    if (!this.adapters[input.ats]) {
      throw new BadRequestException(`Unknown ats: ${input.ats}`);
    }
    // P1 two-track gate. Eligibility is necessary but NOT sufficient: even an
    // eligible job still goes through the approval queue below (AGENTS §3.3).
    await this.assertEligibleToApply(input.userId, input.applicationId);
    const diffJson = await this.buildDiffPreview(input);
    const payload: AtsSubmitApprovalPayload = {
      userId: input.userId,
      applicationId: input.applicationId,
      ats: input.ats,
      jobBoardId: input.jobBoardId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return this.approvals.enqueue({
      userId: input.userId,
      kind: ATS_SUBMIT_APPROVAL_KIND,
      payload,
      diffJson,
    });
  }

  /**
   * Build a minimal diff preview (what will be sent to the ATS) so the F.1
   * approval UI can render it. We only include identifying fields - no
   * API key, no raw PDF bytes.
   */
  private async buildDiffPreview(input: Omit<SubmitInput, 'approvalItemId'>): Promise<unknown> {
    const [app, user] = await Promise.all([
      this.prisma.application.findFirst({
        where: { id: input.applicationId, userId: input.userId },
        select: { id: true, state: true, resumeVariantId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, displayName: true },
      }),
    ]);
    return {
      ats: input.ats,
      jobBoardId: input.jobBoardId,
      candidate: user ? { name: user.displayName ?? user.email, email: user.email } : null,
      application: app
        ? { id: app.id, state: app.state, resumeVariantId: app.resumeVariantId }
        : null,
    };
  }

  /**
   * Public submit entry. Returns the final SubmitResult + the
   * ats_submissions row id so the caller can show status to the user.
   */
  async submit(input: SubmitInput): Promise<{
    submissionId: string;
    status: 'submitted' | 'failed';
    atsApplicationId?: string;
    confirmationUrl?: string;
    reason?: string;
  }> {
    const adapter = this.adapters[input.ats];
    if (!adapter) throw new BadRequestException(`Unknown ats: ${input.ats}`);

    // F.1 wire: every submit must be gated by an approved approval item.
    // A submit without approvalItemId - or one whose approval row is NOT
    // in `approved` state - is refused. This closes the "silently succeed
    // on direct submit" hole the deferred ticket flagged.
    if (!input.approvalItemId) {
      throw new BadRequestException(
        'ATS submit requires an approvalItemId; enqueue via /ats-submit first and approve the item',
      );
    }
    await this.assertApproved(input.userId, input.approvalItemId);

    const ctx = await this.loadContext(input);
    const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(ctx);

    // Upsert the row before the API call so a crash mid-flight leaves
    // a pending row we can retry.
    const row = await this.prisma.atsSubmission.upsert({
      where: {
        applicationId_ats_idempotencyKey: {
          applicationId: input.applicationId,
          ats: input.ats,
          idempotencyKey,
        },
      },
      create: {
        userId: input.userId,
        applicationId: input.applicationId,
        ats: input.ats,
        idempotencyKey,
        status: 'pending',
        attemptCount: 0,
      },
      update: {
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (row.status === 'submitted') {
      // Re-entry: an earlier call already succeeded with this key.
      const resp = row.responseJson as { atsApplicationId?: string; confirmationUrl?: string } | null;
      const out: {
        submissionId: string;
        status: 'submitted' | 'failed';
        atsApplicationId?: string;
        confirmationUrl?: string;
        reason?: string;
      } = { submissionId: row.id, status: 'submitted' };
      if (resp?.atsApplicationId) out.atsApplicationId = resp.atsApplicationId;
      if (resp?.confirmationUrl) out.confirmationUrl = resp.confirmationUrl;
      return out;
    }

    const payload: SubmitPayload = {
      idempotencyKey,
      candidate: ctx.candidate,
      resume: ctx.resume,
      jobBoardId: input.jobBoardId,
    };

    let result: SubmitResult;
    try {
      result = await retry(() => this.callAndCheck(adapter, ctx.credentials, payload), {
        attempts: 3,
        baseMs: 1_000,
        maxMs: 30_000,
        shouldRetry: (err: unknown) => (err as { retryable?: boolean })?.retryable === true,
        onRetry: (_err, attempt, delayMs) => {
          this.logger.warn(`ats ${input.ats} retry ${attempt} in ${delayMs}ms`);
        },
      });
    } catch (err) {
      const failure = err as SubmitResult;
      await this.markFailed(row.id, failure.ok === false ? failure.reason : 'unknown');
      await this.audit(input.userId, 'ats.submit.failed', {
        submissionId: row.id,
        ats: input.ats,
        applicationId: input.applicationId,
        reason: failure.ok === false ? failure.reason : 'unknown',
      });
      return {
        submissionId: row.id,
        status: 'failed',
        reason: failure.ok === false ? failure.reason : 'unknown',
      };
    }

    if (!result.ok) {
      await this.markFailed(row.id, result.reason);
      await this.audit(input.userId, 'ats.submit.failed', {
        submissionId: row.id,
        ats: input.ats,
        applicationId: input.applicationId,
        status: result.status ?? null,
        reason: result.reason,
      });
      return { submissionId: row.id, status: 'failed', reason: result.reason };
    }

    await this.markSubmitted(row.id, result);
    await this.advanceApplicationState(input.applicationId);
    await this.audit(input.userId, 'ats.submit.ok', {
      submissionId: row.id,
      ats: input.ats,
      applicationId: input.applicationId,
      atsApplicationId: result.atsApplicationId,
    });
    const out: {
      submissionId: string;
      status: 'submitted' | 'failed';
      atsApplicationId?: string;
      confirmationUrl?: string;
      reason?: string;
    } = { submissionId: row.id, status: 'submitted', atsApplicationId: result.atsApplicationId };
    if (result.confirmationUrl) out.confirmationUrl = result.confirmationUrl;
    return out;
  }

  async list(userId: string, status?: string) {
    return this.prisma.atsSubmission.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // --- internals ---

  /**
   * Wrap the adapter call so retry() receives a thrown error when the
   * failure is retryable. On terminal failure we return the failure
   * normally so the orchestrator can mark+audit.
   */
  private async callAndCheck(
    adapter: AtsSubmitAdapter,
    creds: AtsCredentials,
    payload: SubmitPayload,
  ): Promise<SubmitResult> {
    const result = await adapter.submit(creds, payload);
    if (!result.ok && result.retryable) {
      // Throw so retry() picks it up; it reads `retryable` via shouldRetry.
      throw result;
    }
    return result;
  }

  private async loadContext(input: SubmitInput): Promise<{
    candidate: SubmitPayload['candidate'];
    resume: SubmitPayload['resume'];
    credentials: AtsCredentials;
  }> {
    const app = await this.prisma.application.findFirst({
      where: { id: input.applicationId, userId: input.userId },
      select: { id: true, resumeVariantId: true },
    });
    if (!app) throw new NotFoundException('Application not found');

    const [user, resumeVariant, integration] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, displayName: true },
      }),
      app.resumeVariantId
        ? this.prisma.resumeVariant.findUnique({
            where: { id: app.resumeVariantId },
            select: { contentJson: true, roleTarget: true, templateId: true },
          })
        : Promise.resolve(null),
      this.prisma.integration.findUnique({
        where: { userId_kind: { userId: input.userId, kind: input.ats } },
      }),
    ]);
    if (!user) throw new NotFoundException('User missing');
    if (!resumeVariant) {
      throw new BadRequestException(
        'Application has no resume variant attached - generate one first',
      );
    }
    if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
      throw new BadRequestException(
        `${input.ats} integration not connected; add it in Settings first`,
      );
    }
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: integration.tokenSecretId },
    });
    if (!secret) throw new BadRequestException(`${input.ats} secret missing`);
    const apiKey = decrypt(secret.ciphertext, KEY, `integration:${input.ats}:apiKey`);
    const extras = (integration.metadata as Record<string, string> | null) ?? undefined;

    const credentials: AtsCredentials = { apiKey };
    if (extras) credentials.extras = extras;

    const candidate: SubmitPayload['candidate'] = {
      name: user.displayName ?? user.email,
      email: user.email,
    };

    // Render the resume variant as a real PDF for upload. ponytail: we
    // render on demand instead of caching the PDF to MinIO. Variants are
    // small, renderResumePdf is deterministic, and the submit path is
    // interactive; caching only pays off if submission throughput shows
    // up as a bottleneck. If it does, store rendered PDFs via
    // StorageService.putResume and look them up by (variantId, hash).
    const resume = await this.renderResume(resumeVariant);

    return { candidate, resume, credentials };
  }

  private async renderResume(variant: {
    contentJson: unknown;
    roleTarget: string | null;
    templateId: string | null;
  }): Promise<SubmitPayload['resume']> {
    const content = unwrapResumeContent(variant.contentJson);
    const contact = unwrapResumeContact(variant.contentJson);
    // P2b: honor the variant's region-template (legacy `ats-first`/`standard`
    // ids normalize to `classic` inside the renderer). The contact block, when
    // present, comes from verified facts only.
    const bytes = await renderResumePdfByTemplate(
      {
        roleTarget: variant.roleTarget ?? '',
        // ponytail: no jobCompany lookup here - the PDF header line is cosmetic
        // and the ATS discards it on parse. If a template ever requires it,
        // add a NormalizedJob join in loadContext.
        jobCompany: null,
        ...(contact ? { contact } : {}),
        content,
      },
      variant.templateId ? { template: variant.templateId } : {},
    );
    return { bytes, filename: 'resume.pdf' };
  }

  /**
   * P1 two-track eligibility gate. Loads the tracked job + targeting profile
   * and refuses to enqueue an application for a job that isn't VERIFIED with a
   * passing authorization-or-sponsorship track. Every decision (allow or block)
   * is written to the audit log.
   */
  private async assertEligibleToApply(userId: string, applicationId: string): Promise<void> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      select: { jobId: true },
    });
    if (!app) throw new NotFoundException('Application not found');

    const [job, prefs] = await Promise.all([
      this.prisma.normalizedJob.findUnique({
        where: { id: app.jobId },
        select: { id: true, state: true, country: true, sponsorshipSignal: true },
      }),
      this.prisma.userJobPreferences.findUnique({
        where: { userId },
        select: {
          homeCountry: true,
          citizenships: true,
          workAuthorizations: true,
          sponsorshipCountries: true,
        },
      }),
    ]);
    if (!job) throw new NotFoundException('Job not found for application');

    const decision = isEligibleToApply(
      {
        homeCountry: prefs?.homeCountry ?? null,
        citizenships: prefs?.citizenships ?? [],
        workAuthorizations: prefs?.workAuthorizations ?? [],
        sponsorshipCountries: prefs?.sponsorshipCountries ?? [],
      },
      { state: job.state, country: job.country, sponsorshipSignal: job.sponsorshipSignal },
    );

    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action: 'ats.eligibility.decision',
          resourceType: 'normalized_job',
          resourceId: job.id,
          payload: {
            applicationId,
            eligible: decision.eligible,
            reason: decision.reason,
            authorization: decision.authorization,
            sponsorship: decision.sponsorship,
            state: job.state,
          } as never,
        },
      })
      .catch(() => undefined);

    if (!decision.eligible) {
      throw new BadRequestException(
        `Job is not eligible to apply (${decision.reason}); eligibility is required before an approval can be queued`,
      );
    }
  }

  private async assertApproved(userId: string, approvalItemId: string): Promise<void> {
    const row = await this.prisma.approvalItem.findFirst({
      where: { id: approvalItemId, userId },
      select: { state: true, kind: true },
    });
    if (!row) {
      throw new BadRequestException(`Approval item ${approvalItemId} not found`);
    }
    if (row.kind !== ATS_SUBMIT_APPROVAL_KIND) {
      throw new BadRequestException(
        `Approval item ${approvalItemId} is for ${row.kind}, not ats_submit`,
      );
    }
    if (row.state !== 'approved') {
      throw new BadRequestException(
        `Approval item ${approvalItemId} is in state '${row.state}'; must be 'approved' to submit`,
      );
    }
  }

  private async markFailed(submissionId: string, reason: string): Promise<void> {
    await this.prisma.atsSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'failed',
        lastError: reason.slice(0, 1000),
      },
    });
  }

  private async markSubmitted(submissionId: string, result: SubmitResult & { ok: true }): Promise<void> {
    await this.prisma.atsSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        responseJson: {
          atsApplicationId: result.atsApplicationId,
          ...(result.confirmationUrl ? { confirmationUrl: result.confirmationUrl } : {}),
          ...(result.atsStatus ? { atsStatus: result.atsStatus } : {}),
        } as never,
      },
    });
  }

  private async advanceApplicationState(applicationId: string): Promise<void> {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { state: true, appliedAt: true },
    });
    if (!app) return;
    // Only move forward from pre-applied states to 'applied'; never
    // regress an interviewing/offer/rejected row back to applied.
    if (app.state !== 'interested') return;
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        state: 'applied',
        appliedAt: app.appliedAt ?? new Date(),
      },
    });
  }

  private async audit(
    userId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'user',
          action,
          resourceType: 'ats_submission',
          resourceId: null,
          payload: payload as never,
        },
      })
      .catch(() => undefined);
  }
}

/**
 * Deterministic key: hash of (applicationId, resumeVariantId or 'none',
 * random slot). Including the resumeVariantId means a user who swaps
 * resumes gets a NEW key (which they want, so the ATS sees the new
 * resume). The random slot is only generated once per Application and
 * stored... actually we skip the random slot per MVP; two submits with
 * the same (app, resumeVariant) collapse into one, which is the
 * intended idempotency behavior.
 */
function deriveIdempotencyKey(ctx: {
  candidate: SubmitPayload['candidate'];
  resume: SubmitPayload['resume'];
}): string {
  const material = JSON.stringify({
    email: ctx.candidate.email,
    name: ctx.candidate.name,
    filename: ctx.resume.filename,
    // Hash of bytes if present; empty-string hash is stable for the
    // MVP stub resume.
    resumeHash: createHash('sha256').update(ctx.resume.bytes).digest('hex'),
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

// Exposed so a caller that wants a fresh resubmit (edge case) can
// request a fresh key per randomUUID() instead of the deterministic
// one.
export function freshIdempotencyKey(): string {
  return randomUUID().replace(/-/g, '').slice(0, 32);
}

/**
 * Resume-variant contentJson is stored in two shapes (slice-19 bare content
 * vs slice-20 `{content, audit}` wrapper). Mirror ResumeVariantsService's
 * reader so renderResumePdf gets the right object either way.
 */
function unwrapResumeContent(raw: unknown): TailoredResumeContent {
  if (raw && typeof raw === 'object' && 'content' in (raw as Record<string, unknown>)) {
    return (raw as { content: TailoredResumeContent }).content;
  }
  return raw as TailoredResumeContent;
}

/** Extract the verified contact block from the stored `{content, audit, contact}` wrapper. */
function unwrapResumeContact(raw: unknown): ResumeContact | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const contact = (raw as Record<string, unknown>).contact;
  return contact && typeof contact === 'object' ? (contact as ResumeContact) : undefined;
}

/**
 * Narrow unknown approval payload JSON into AtsSubmitApprovalPayload or
 * return null when the shape doesn't match (defensive: approvals.payload
 * is `unknown` on the Prisma row).
 */
function parseApprovalPayload(raw: unknown): AtsSubmitApprovalPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.userId !== 'string' ||
    typeof r.applicationId !== 'string' ||
    typeof r.jobBoardId !== 'string' ||
    (r.ats !== 'ashby' && r.ats !== 'greenhouse')
  ) {
    return null;
  }
  const out: AtsSubmitApprovalPayload = {
    userId: r.userId,
    applicationId: r.applicationId,
    ats: r.ats,
    jobBoardId: r.jobBoardId,
  };
  if (typeof r.idempotencyKey === 'string') out.idempotencyKey = r.idempotencyKey;
  return out;
}
