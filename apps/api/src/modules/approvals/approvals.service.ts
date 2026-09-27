import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SensitivityGate } from '@careeros/ai';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APPROVAL_REAUTH_OP,
  BULK_APPROVAL_THRESHOLD,
  IllegalStateError,
  KINDS_REQUIRING_FRESH_REAUTH,
  assertTransition,
  isApprovalKind,
  isApprovalState,
  type ApprovalKind,
  type ApprovalState,
} from './state-machine';

/** DI token for the shared SensitivityGate instance (see approvals.module.ts). */
export const APPROVAL_SENSITIVITY_GATE = Symbol('APPROVAL_SENSITIVITY_GATE');

/** Interface future submitters (F.2 ATS, F.5 outreach, ...) implement. */
export interface ApprovalsWorker {
  /** Kinds this worker handles - the module fans out approvals to matching workers. */
  handles(kind: ApprovalKind): boolean;
  /** Called once per approved item. Worker's job: call markSent / markFailed. */
  onApproved(item: ApprovalItemDto): Promise<void> | void;
}

export interface ApprovalItemDto {
  id: string;
  userId: string;
  kind: ApprovalKind;
  payload: unknown;
  diffJson: unknown;
  state: ApprovalState;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  failedReason: string | null;
}

interface ListPage {
  items: ApprovalItemDto[];
  nextCursor: string | null;
}

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly workers: ApprovalsWorker[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APPROVAL_SENSITIVITY_GATE) private readonly gate: SensitivityGate,
  ) {}

  /** Consumer registration hook (F.2/F.3/F.5 wire in via module `onModuleInit`). */
  registerWorker(worker: ApprovalsWorker): void {
    this.workers.push(worker);
  }

  async enqueue(input: {
    userId: string;
    kind: string;
    payload: unknown;
    diffJson: unknown;
  }): Promise<ApprovalItemDto> {
    if (!isApprovalKind(input.kind)) {
      throw new IllegalStateError('(new)', input.kind);
    }
    const row = await this.prisma.approvalItem.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        payload: input.payload as never,
        diffJson: input.diffJson as never,
        state: 'pending',
        events: {
          create: {
            event: 'approval.enqueued',
            actor: 'agent',
            meta: { kind: input.kind } as never,
          },
        },
      },
    });
    await this.writeAudit(input.userId, 'approval.enqueued', row.id, {
      kind: input.kind,
    });
    return dtoOf(row);
  }

  /**
   * Transition pending -> approved. When `requiresFreshReauth` is set (either
   * the caller flag OR the kind's static requirement), verify a fresh re-auth
   * window before proceeding.
   */
  async approve(input: {
    userId: string;
    itemId: string;
    requiresFreshReauth?: boolean;
  }): Promise<ApprovalItemDto> {
    const row = await this.mustLoad(input.userId, input.itemId);
    if (!isApprovalKind(row.kind)) throw new IllegalStateError(row.state, 'approved');
    const staticGate = KINDS_REQUIRING_FRESH_REAUTH.has(row.kind);
    const needsReauth = Boolean(input.requiresFreshReauth) || staticGate;
    if (needsReauth && !this.gate.hasFreshReauth(input.userId, APPROVAL_REAUTH_OP)) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    assertTransition(row.state, 'approved');
    const updated = await this.prisma.approvalItem.update({
      where: { id: row.id },
      data: {
        state: 'approved',
        decidedAt: new Date(),
        events: {
          create: {
            event: 'approval.approved',
            actor: 'user',
            meta: { staticGate } as never,
          },
        },
      },
    });
    await this.writeAudit(input.userId, 'approval.approved', row.id, {
      kind: row.kind,
      staticGate,
    });
    // Fire-and-forget dispatch to matching workers. Worker's failure is
    // captured in markFailed, not by throwing from approve().
    void this.dispatch(dtoOf(updated));
    return dtoOf(updated);
  }

  async cancel(input: {
    userId: string;
    itemId: string;
    reason?: string;
  }): Promise<ApprovalItemDto> {
    const row = await this.mustLoad(input.userId, input.itemId);
    assertTransition(row.state, 'cancelled');
    const updated = await this.prisma.approvalItem.update({
      where: { id: row.id },
      data: {
        state: 'cancelled',
        decidedAt: new Date(),
        events: {
          create: {
            event: 'approval.cancelled',
            actor: 'user',
            meta: (input.reason ? { reason: input.reason } : undefined) as never,
          },
        },
      },
    });
    await this.writeAudit(input.userId, 'approval.cancelled', row.id, {
      kind: row.kind,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return dtoOf(updated);
  }

  /** Consumer callback: approved -> sent. */
  async markSent(input: { itemId: string; meta?: Record<string, unknown> }): Promise<ApprovalItemDto> {
    const row = await this.prisma.approvalItem.findUnique({ where: { id: input.itemId } });
    if (!row) throw new NotFoundException('Approval item not found');
    assertTransition(row.state, 'sent');
    const updated = await this.prisma.approvalItem.update({
      where: { id: row.id },
      data: {
        state: 'sent',
        sentAt: new Date(),
        events: {
          create: {
            event: 'approval.sent',
            actor: 'system',
            meta: (input.meta ?? undefined) as never,
          },
        },
      },
    });
    await this.writeAudit(row.userId, 'approval.sent', row.id, {
      kind: row.kind,
      ...(input.meta ?? {}),
    });
    return dtoOf(updated);
  }

  /** Consumer callback: approved -> failed. */
  async markFailed(input: { itemId: string; reason: string }): Promise<ApprovalItemDto> {
    const row = await this.prisma.approvalItem.findUnique({ where: { id: input.itemId } });
    if (!row) throw new NotFoundException('Approval item not found');
    assertTransition(row.state, 'failed');
    const updated = await this.prisma.approvalItem.update({
      where: { id: row.id },
      data: {
        state: 'failed',
        failedReason: input.reason,
        events: {
          create: {
            event: 'approval.failed',
            actor: 'system',
            meta: { reason: input.reason } as never,
          },
        },
      },
    });
    await this.writeAudit(row.userId, 'approval.failed', row.id, {
      kind: row.kind,
      reason: input.reason,
    });
    return dtoOf(updated);
  }

  /**
   * Bulk approve. If N > BULK_APPROVAL_THRESHOLD, require fresh re-auth for
   * the whole batch (even if no individual kind requires it). If ANY item's
   * kind requires fresh re-auth, that also gates the batch.
   *
   * Returns per-item results. Individual approve() failures do NOT abort the
   * batch - the caller sees a mixed { approved, errored } split.
   */
  async bulkApprove(input: {
    userId: string;
    itemIds: string[];
  }): Promise<{
    approved: ApprovalItemDto[];
    errored: Array<{ itemId: string; reason: string }>;
    reauthRequired: boolean;
  }> {
    const rows = await this.prisma.approvalItem.findMany({
      where: { id: { in: input.itemIds }, userId: input.userId },
    });
    const kinds = rows
      .map((r) => r.kind)
      .filter(isApprovalKind);
    const anyKindGated = kinds.some((k) => KINDS_REQUIRING_FRESH_REAUTH.has(k));
    const bulkOverThreshold = input.itemIds.length > BULK_APPROVAL_THRESHOLD;
    const reauthRequired = anyKindGated || bulkOverThreshold;
    if (reauthRequired && !this.gate.hasFreshReauth(input.userId, APPROVAL_REAUTH_OP)) {
      // Audit the enforcement so operators can see rate of blocked bulks.
      await this.writeAudit(input.userId, 'approval.bulk_reauth_required', null, {
        count: input.itemIds.length,
        threshold: BULK_APPROVAL_THRESHOLD,
        anyKindGated,
        bulkOverThreshold,
      });
      throw new ForbiddenException('Fresh re-authentication required for bulk approval');
    }
    const approved: ApprovalItemDto[] = [];
    const errored: Array<{ itemId: string; reason: string }> = [];
    for (const id of input.itemIds) {
      try {
        approved.push(
          await this.approve({
            userId: input.userId,
            itemId: id,
            // We already gated above; individual approve() re-checks static
            // kinds and passes because the same gate window covers them.
          }),
        );
      } catch (err) {
        errored.push({ itemId: id, reason: (err as Error).message });
      }
    }
    return { approved, errored, reauthRequired };
  }

  /**
   * Paginated pending / by-state list. Cursor = createdAt+id compound. Keeps
   * queries fast even with lots of history since (userId, state, createdAt)
   * is indexed.
   */
  async list(input: {
    userId: string;
    state?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<ListPage> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const stateFilter = input.state && isApprovalState(input.state) ? input.state : undefined;
    const cursorAt = decodeCursor(input.cursor ?? null);
    const rows = await this.prisma.approvalItem.findMany({
      where: {
        userId: input.userId,
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(cursorAt ? { createdAt: { lt: cursorAt } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(dtoOf),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt) : null,
    };
  }

  async getById(userId: string, id: string): Promise<ApprovalItemDto> {
    const row = await this.mustLoad(userId, id);
    return dtoOf(row);
  }

  // ---------- internals ----------

  private async mustLoad(userId: string, id: string): Promise<PrismaApprovalRow> {
    const row = await this.prisma.approvalItem.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Approval item not found');
    return row as PrismaApprovalRow;
  }

  private async writeAudit(
    userId: string | null,
    action: string,
    resourceId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: action.endsWith('.enqueued') || action.endsWith('.sent') || action.endsWith('.failed')
            ? 'system'
            : 'user',
          action,
          resourceType: 'approval_item',
          resourceId,
          payload: payload as never,
        },
      })
      .catch((err) => {
        // Audit must not break the mutation.
        this.logger.warn({ err, action }, 'approval audit write failed');
      });
  }

  private async dispatch(item: ApprovalItemDto): Promise<void> {
    for (const w of this.workers) {
      if (!w.handles(item.kind)) continue;
      try {
        await w.onApproved(item);
      } catch (err) {
        this.logger.error({ err, itemId: item.id, kind: item.kind }, 'approvals worker threw');
      }
    }
  }
}

// Local row-shape alias so we don't drag the Prisma client type into the DTO.
type PrismaApprovalRow = {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  diffJson: unknown;
  state: string;
  createdAt: Date;
  decidedAt: Date | null;
  sentAt: Date | null;
  failedReason: string | null;
};

function dtoOf(row: PrismaApprovalRow): ApprovalItemDto {
  const kind = isApprovalKind(row.kind) ? row.kind : ('ats_submit' satisfies ApprovalKind);
  const state = isApprovalState(row.state) ? row.state : ('pending' satisfies ApprovalState);
  return {
    id: row.id,
    userId: row.userId,
    kind,
    payload: row.payload,
    diffJson: row.diffJson,
    state,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    failedReason: row.failedReason,
  };
}

function encodeCursor(at: Date): string {
  return Buffer.from(at.toISOString(), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): Date | null {
  if (!cursor) return null;
  try {
    const iso = Buffer.from(cursor, 'base64url').toString('utf8');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export { IllegalStateError };
