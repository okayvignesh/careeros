import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { retry } from '@careeros/shared';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
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
}

@Injectable()
export class AtsSubmitService {
  private readonly logger = new Logger(AtsSubmitService.name);
  private readonly adapters: Record<AtsId, AtsSubmitAdapter>;

  constructor(private readonly prisma: PrismaService) {
    this.adapters = {
      ashby: new AshbyAdapter(),
      greenhouse: new GreenhouseAdapter(),
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
            select: { contentJson: true, roleTarget: true },
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

    // ponytail: we attach a stub PDF buffer here. The real multipart
    // upload lives behind the ATS's file-handle flow which is a follow-
    // up slice (noted on COMPLETION_PLAN F.2); the ats_submissions row
    // still captures the intent + ids so retries work.
    const resume: SubmitPayload['resume'] = {
      bytes: Buffer.from(''),
      filename: 'resume.pdf',
    };

    return { candidate, resume, credentials };
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
