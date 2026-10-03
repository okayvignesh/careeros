import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AgentTask,
  AgentTaskKind,
  defaultAllowlistDir,
  isAgentPaused,
  loadAllowlistDir,
  pickFormFillScript,
  type AllowlistEntry,
  type FormFillPayload,
} from '@careeros/browser-agent';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApprovalsService,
  type ApprovalItemDto,
  type ApprovalsWorker,
} from '../approvals/approvals.service';
import type { ApprovalKind } from '../approvals/state-machine';
import { AgentGateway } from './agent.gateway';
import { AgentService, type AgentTaskResultEvent, type AgentTaskResultListener } from './agent.service';

/**
 * A2: the missing `agent_form_fill` execution path.
 *
 * An approved `agent_form_fill` item is a specific desktop-agent task (an
 * `AgentTaskKind` such as `ashby-apply`). On approve this worker:
 *
 *   1. Validates the stored payload (kind/url/form payload/sensitivity).
 *   2. Re-checks the shared kill-switch and the form-fill allowlist.
 *   3. Picks one of the user's non-revoked devices that currently has a live
 *      WSS socket (AgentGateway tracks connected device ids).
 *   4. Persists an `AgentTask` row and pushes the AgentTask envelope over the
 *      existing `/agent/ws` gateway.
 *   5. Waits for the device's result (posted to `POST /agent/tasks/:id/result`
 *      and fanned out by AgentService) and drives the approval to its terminal
 *      `sent` / `failed` state with the device's reason.
 *
 * Every branch writes an audit row. No branch no-ops silently.
 */

export const AGENT_FORM_FILL_APPROVAL_KIND: ApprovalKind = 'agent_form_fill';

/** Nest DI token for the loaded form-fill allowlist (domain -> entry). */
export const AGENT_FORM_FILL_ALLOWLIST = Symbol('AGENT_FORM_FILL_ALLOWLIST');
/** Nest DI token for the kill-switch reader (defaults to browser-agent isAgentPaused). */
export const AGENT_KILL_SWITCH = Symbol('AGENT_KILL_SWITCH');

/** Task rows the device never picks up expire after 30 min (mirrors AgentService). */
const TASK_TTL_MS = 30 * 60 * 1000;

const SENSITIVITIES = ['public', 'personal', 'confidential', 'employer-confidential'] as const;
type Sensitivity = (typeof SENSITIVITIES)[number];

/** Data we refuse to put on an external job site even with explicit approval. */
const BLOCKED_SENSITIVITIES: ReadonlySet<Sensitivity> = new Set(['employer-confidential']);

/**
 * Shape stored on `approval_items.payload` for `agent_form_fill`. The approval
 * UI diff-preview reads the same fields.
 */
export interface AgentFormFillApprovalPayload {
  userId: string;
  taskKind: AgentTaskKind;
  url: string;
  applicationId?: string;
  jobId?: string;
  formPayload?: FormFillPayload;
  sensitivity?: Sensitivity;
}

interface StoredTaskParams {
  url: string;
  mode: 'live';
  payload?: FormFillPayload;
  approvalItemId: string;
  applicationId?: string;
  jobId?: string;
}

@Injectable()
export class AgentApprovalWorker implements ApprovalsWorker, AgentTaskResultListener, OnModuleInit {
  private readonly logger = new Logger(AgentApprovalWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly agents: AgentService,
    private readonly gateway: AgentGateway,
    @Inject(AGENT_FORM_FILL_ALLOWLIST) private readonly allowlist: Map<string, AllowlistEntry>,
    @Inject(AGENT_KILL_SWITCH) private readonly isPaused: () => boolean,
  ) {}

  onModuleInit(): void {
    this.approvals.registerWorker(this);
    this.agents.registerResultListener(this);
  }

  handles(kind: ApprovalKind): boolean {
    return kind === AGENT_FORM_FILL_APPROVAL_KIND;
  }

  /**
   * Enqueue an agent form-fill for approval. The actual dispatch happens from
   * `onApproved` once a human approves the item.
   */
  async enqueue(input: {
    userId: string;
    taskKind: AgentTaskKind;
    url: string;
    applicationId?: string;
    jobId?: string;
    formPayload?: FormFillPayload;
    sensitivity?: Sensitivity;
  }): Promise<ApprovalItemDto> {
    const payload: AgentFormFillApprovalPayload = {
      userId: input.userId,
      taskKind: input.taskKind,
      url: input.url,
      ...(input.applicationId ? { applicationId: input.applicationId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.formPayload ? { formPayload: input.formPayload } : {}),
      ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
    };
    return this.approvals.enqueue({
      userId: input.userId,
      kind: AGENT_FORM_FILL_APPROVAL_KIND,
      payload,
      diffJson: {
        taskKind: input.taskKind,
        url: input.url,
        applicationId: input.applicationId ?? null,
        jobId: input.jobId ?? null,
        candidateName: input.formPayload?.name ?? null,
      },
    });
  }

  async onApproved(item: ApprovalItemDto): Promise<void> {
    try {
      await this.dispatch(item);
    } catch (err) {
      await this.fail(item, `dispatch exception: ${(err as Error).message ?? 'unknown'}`);
    }
  }

  /**
   * Device result callback (wired through AgentService.registerResultListener).
   * Maps the AgentTask back to its approval item and records the terminal
   * approval state with the device's reason.
   */
  async onTaskResult(event: AgentTaskResultEvent): Promise<void> {
    const task = await this.prisma.agentTask.findUnique({
      where: { id: event.taskId },
      select: { params: true, device: { select: { userId: true } } },
    });
    const params = task?.params as StoredTaskParams | undefined;
    const approvalItemId = params?.approvalItemId;
    if (!approvalItemId) return;
    const userId = task?.device.userId ?? null;

    // markSent / markFailed write the approval.sent / approval.failed audit
    // rows; the agent.* rows below add the device-side reason + task id.
    try {
      if (event.status === 'completed') {
        await this.approvals.markSent({
          itemId: approvalItemId,
          meta: { agentTaskId: event.taskId, status: event.status },
        });
        await this.audit(userId, 'agent.form_fill.sent', {
          approvalItemId,
          taskId: event.taskId,
          result: event.resultJson ?? null,
        });
      } else {
        const reason = reasonFrom(event.resultJson) ?? `task ${event.status}`;
        await this.approvals.markFailed({ itemId: approvalItemId, reason });
        await this.audit(userId, 'agent.form_fill.failed', {
          approvalItemId,
          taskId: event.taskId,
          reason,
        });
      }
    } catch (err) {
      // Item already terminal (e.g. duplicate result); the device post still
      // succeeded, so surface the anomaly without throwing.
      this.logger.warn(
        `agent.form_fill result for approval ${approvalItemId} not applied: ${(err as Error).message}`,
      );
    }
  }

  // ---------- internals ----------

  private async dispatch(item: ApprovalItemDto): Promise<void> {
    const payload = parsePayload(item.payload);
    if (!payload) {
      await this.fail(item, 'invalid payload');
      return;
    }
    if (!AgentTaskKind.safeParse(payload.taskKind).success) {
      await this.fail(item, `unknown task kind '${String(payload.taskKind)}'`);
      return;
    }
    if (!pickFormFillScript(payload.taskKind)) {
      await this.fail(item, `task kind '${payload.taskKind}' has no form-fill script`);
      return;
    }
    if (payload.sensitivity && BLOCKED_SENSITIVITIES.has(payload.sensitivity)) {
      await this.fail(
        item,
        `sensitivity '${payload.sensitivity}' cannot be submitted to an external site`,
      );
      return;
    }
    const hostname = safeHostname(payload.url);
    if (!hostname) {
      await this.fail(item, 'invalid url');
      return;
    }
    const entry = matchAllowlist(this.allowlist, hostname);
    if (!entry) {
      await this.fail(item, `domain-not-allowlisted: ${hostname}`);
      return;
    }
    if (this.isPaused()) {
      await this.fail(item, 'kill-switch active');
      return;
    }

    const device = await this.pickOnlineDevice(payload.userId);
    if (!device) {
      await this.fail(
        item,
        `no online device paired for user ${payload.userId}; open the desktop agent and retry`,
      );
      return;
    }

    const now = new Date();
    const taskId = randomUUID();
    const params: StoredTaskParams = {
      url: payload.url,
      mode: 'live',
      approvalItemId: item.id,
      ...(payload.applicationId ? { applicationId: payload.applicationId } : {}),
      ...(payload.jobId ? { jobId: payload.jobId } : {}),
      ...(payload.formPayload ? { payload: payload.formPayload } : {}),
    };
    const envelope = AgentTask.parse({
      id: taskId,
      kind: payload.taskKind,
      params,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TASK_TTL_MS).toISOString(),
    });

    await this.prisma.agentTask.create({
      data: {
        id: taskId,
        deviceId: device.id,
        kind: payload.taskKind,
        params: params as never,
        status: 'queued',
        expiresAt: new Date(now.getTime() + TASK_TTL_MS),
      },
    });

    try {
      this.gateway.pushTask(device.id, envelope);
    } catch (err) {
      await this.prisma.agentTask
        .update({
          where: { id: taskId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            resultJson: { reason: 'wss dispatch failed' } as never,
          },
        })
        .catch(() => undefined);
      await this.fail(item, `wss dispatch failed: ${(err as Error).message ?? 'unknown'}`);
      return;
    }

    await this.audit(payload.userId, 'agent.form_fill.dispatched', {
      approvalItemId: item.id,
      taskId,
      deviceId: device.id,
      taskKind: payload.taskKind,
      domain: hostname,
    });
  }

  private async pickOnlineDevice(userId: string) {
    const devices = await this.prisma.agentDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true },
    });
    return devices.find((d) => this.gateway.isDeviceOnline(d.id)) ?? null;
  }

  private async fail(item: ApprovalItemDto, reason: string): Promise<void> {
    await this.audit(item.userId, 'agent.form_fill.failed', {
      approvalItemId: item.id,
      reason,
    });
    await this.approvals.markFailed({ itemId: item.id, reason });
  }

  private async audit(
    userId: string | null,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action,
          resourceType: 'approval_item',
          resourceId: (payload.approvalItemId as string | undefined) ?? null,
          payload: payload as never,
        },
      })
      .catch(() => undefined);
  }
}

/**
 * Match a hostname to an allowlist entry. Mirrors the desktop task-runner's
 * `matchAllowlist` (exact -> suffix -> wildcard) so server-side pre-flight and
 * the agent's navigation guard agree.
 */
export function matchAllowlist(
  allowlist: Map<string, AllowlistEntry>,
  hostname: string,
): AllowlistEntry | null {
  const host = hostname.toLowerCase();
  const exact = allowlist.get(host);
  if (exact) return exact;
  for (const [domain, entry] of allowlist) {
    if (domain === '*') continue;
    if (host === domain || host.endsWith(`.${domain}`)) return entry;
  }
  return allowlist.get('*') ?? null;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parsePayload(raw: unknown): AgentFormFillApprovalPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string' || r.userId.length === 0) return null;
  if (typeof r.taskKind !== 'string') return null;
  if (typeof r.url !== 'string' || r.url.length === 0) return null;
  const out: AgentFormFillApprovalPayload = {
    userId: r.userId,
    taskKind: r.taskKind as AgentTaskKind,
    url: r.url,
  };
  if (typeof r.applicationId === 'string') out.applicationId = r.applicationId;
  if (typeof r.jobId === 'string') out.jobId = r.jobId;
  if (isFormFillPayload(r.formPayload)) out.formPayload = r.formPayload;
  if (isSensitivity(r.sensitivity)) out.sensitivity = r.sensitivity;
  return out;
}

function isFormFillPayload(v: unknown): v is FormFillPayload {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSensitivity(v: unknown): v is Sensitivity {
  return typeof v === 'string' && (SENSITIVITIES as readonly string[]).includes(v);
}

/** Device resultJson is either the desktop TaskResult (failureReason) or AgentResult (error). */
function reasonFrom(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const r = resultJson as Record<string, unknown>;
  if (typeof r.failureReason === 'string' && r.failureReason) return r.failureReason.slice(0, 500);
  if (typeof r.error === 'string' && r.error) return r.error.slice(0, 500);
  return null;
}

/** Nest provider factory: load the shared allowlist once at boot, fail closed. */
export function loadAgentAllowlist(): Map<string, AllowlistEntry> {
  try {
    return loadAllowlistDir(defaultAllowlistDir());
  } catch {
    return new Map();
  }
}

/** Nest provider factory: bind the shared browser-agent kill-switch reader. */
export function killSwitchReader(): () => boolean {
  return () => isAgentPaused();
}
