// A2: agent_form_fill approval execution path.
//
// In-memory fake Prisma + real ApprovalsService + real AgentService. The WSS
// gateway is mocked (online set + pushTask spy). Covers:
//   - no online device -> failed + agent.form_fill.failed audit, no task row
//   - device online -> AgentTask envelope persisted + pushed; result -> sent
//   - device failure result -> failed with the device's reason
//   - kill-switch active -> failed, nothing pushed
//   - non-allowlisted domain -> failed, nothing pushed
//   - employer-confidential payload -> failed, nothing pushed
//   - approved agent_form_fill never hits the A7 fail-loud (approval.unexecutable)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTask } from '@careeros/browser-agent';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  AGENT_FORM_FILL_APPROVAL_KIND,
  AgentApprovalWorker,
  matchAllowlist,
} from './agent-approval.worker';
import { AgentService } from './agent.service';
import type { AgentGateway } from './agent.gateway';

type Device = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
};
type ApprovalRow = {
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
type TaskRow = {
  id: string;
  deviceId: string;
  kind: string;
  params: unknown;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  resultJson: unknown;
  expiresAt: Date;
};
type AuditRow = { userId: string | null; action: string; resourceId: string | null; payload: unknown };

let seq = 0;
const nid = () => `id-${++seq}`;

function fakePrisma(devices: Device[]) {
  const approvals: ApprovalRow[] = [];
  const tasks: TaskRow[] = [];
  const audits: AuditRow[] = [];
  const p = {
    _approvals: approvals,
    _tasks: tasks,
    _audits: audits,
    _devices: devices,
    approvalItem: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: ApprovalRow = {
          id: nid(),
          userId: data.userId as string,
          kind: data.kind as string,
          payload: data.payload,
          diffJson: data.diffJson,
          state: 'pending',
          createdAt: new Date(),
          decidedAt: null,
          sentAt: null,
          failedReason: null,
        };
        approvals.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = approvals.find((r) => r.id === where.id);
        if (!row) throw new Error('no item');
        if (typeof data.state === 'string') row.state = data.state;
        if (data.decidedAt instanceof Date) row.decidedAt = data.decidedAt;
        if (data.sentAt instanceof Date) row.sentAt = data.sentAt;
        if (typeof data.failedReason === 'string') row.failedReason = data.failedReason;
        return { ...row };
      },
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) => {
        const row = approvals.find(
          (r) => r.id === where.id && (where.userId ? r.userId === where.userId : true),
        );
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = approvals.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
    },
    agentDevice: {
      findMany: async ({ where }: { where: { userId: string; revokedAt: null } }) =>
        devices
          .filter((d) => d.userId === where.userId && d.revokedAt === null)
          .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
          .map((d) => ({ id: d.id })),
    },
    agentTask: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: TaskRow = {
          id: data.id as string,
          deviceId: data.deviceId as string,
          kind: data.kind as string,
          params: data.params,
          status: (data.status as string) ?? 'queued',
          createdAt: new Date(),
          completedAt: null,
          resultJson: null,
          expiresAt: data.expiresAt as Date,
        };
        tasks.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const t = tasks.find((r) => r.id === where.id);
        if (!t) return null;
        const device = devices.find((d) => d.id === t.deviceId);
        return { params: t.params, device: device ? { userId: device.userId } : null };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; deviceId: string; status: { in: string[] } };
        data: { status: string; completedAt: Date; resultJson: unknown };
      }) => {
        let n = 0;
        for (const t of tasks) {
          if (t.id === where.id && t.deviceId === where.deviceId && where.status.in.includes(t.status)) {
            t.status = data.status;
            t.completedAt = data.completedAt;
            t.resultJson = data.resultJson;
            n += 1;
          }
        }
        return { count: n };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = tasks.find((r) => r.id === where.id);
        if (t) {
          if (typeof data.status === 'string') t.status = data.status;
          if (data.completedAt instanceof Date) t.completedAt = data.completedAt;
          if (data.resultJson !== undefined) t.resultJson = data.resultJson;
        }
        return t ? { ...t } : null;
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Omit<AuditRow, never> }) => {
        audits.push({
          userId: data.userId ?? null,
          action: data.action,
          resourceId: (data as { resourceId?: string | null }).resourceId ?? null,
          payload: data.payload,
        });
        return {};
      },
    },
  };
  return p;
}

function fakeGateway(online: Set<string>, pushThrows = false) {
  const pushed: Array<{ deviceId: string; task: unknown }> = [];
  return {
    _pushed: pushed,
    isDeviceOnline: (id: string) => online.has(id),
    pushTask: vi.fn((deviceId: string, task: unknown) => {
      if (pushThrows) throw new Error('socket down');
      pushed.push({ deviceId, task });
    }),
  };
}

const ASHBY_ENTRY = {
  domain: 'ashbyhq.com',
  allowed_paths: ['/'],
  forbidden_selectors: [],
  required_headers: ['user-agent'],
};

function harness(opts: {
  online?: boolean;
  paused?: boolean;
  allowlisted?: boolean;
  pushThrows?: boolean;
  devices?: Device[];
} = {}) {
  const device: Device = {
    id: 'dev-1',
    userId: 'user-1',
    revokedAt: null,
    lastSeenAt: new Date(),
  };
  const devices = opts.devices ?? [device];
  const prisma = fakePrisma(devices);
  const approvals = new ApprovalsService(
    prisma as never,
    new SensitivityGateService({} as never, { warn() {} } as never),
  );
  const agents = new AgentService(prisma as never, {} as never);
  const online = new Set(opts.online === false ? [] : [device.id]);
  const gateway = fakeGateway(online, opts.pushThrows === true);
  const allowlist =
    opts.allowlisted === false
      ? new Map()
      : new Map([['ashbyhq.com', ASHBY_ENTRY as never]]);
  const worker = new AgentApprovalWorker(
    prisma as never,
    approvals,
    agents,
    gateway as unknown as AgentGateway,
    allowlist,
    () => opts.paused === true,
  );
  worker.onModuleInit();
  return { prisma, approvals, agents, gateway, worker, device };
}

async function drain(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    taskKind: 'ashby-apply' as const,
    url: 'https://jobs.ashbyhq.com/acme/apply',
    applicationId: 'app-1',
    jobId: 'job-1',
    formPayload: { name: 'Ada', email: 'ada@example.com' },
    ...extra,
  };
}

beforeEach(() => {
  seq = 0;
});

describe('AgentApprovalWorker', () => {
  it('enqueue() parks an agent_form_fill approval item with a diff preview', async () => {
    const { worker, prisma } = harness();
    const item = await worker.enqueue({
      userId: 'user-1',
      taskKind: 'ashby-apply',
      url: 'https://jobs.ashbyhq.com/acme/apply',
      applicationId: 'app-1',
      formPayload: { name: 'Ada' },
    });
    expect(item.kind).toBe(AGENT_FORM_FILL_APPROVAL_KIND);
    expect(item.state).toBe('pending');
    expect(prisma._approvals[0]!.diffJson).toMatchObject({
      taskKind: 'ashby-apply',
      applicationId: 'app-1',
      candidateName: 'Ada',
    });
  });

  it('fails the approval + audits when no device is online (no silent no-op)', async () => {
    const { worker, approvals, gateway, prisma } = harness({ online: false });
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    const row = prisma._approvals.find((r) => r.id === item.id)!;
    expect(row.state).toBe('failed');
    expect(row.failedReason).toContain('no online device');
    expect(gateway._pushed).toHaveLength(0);
    expect(prisma._tasks).toHaveLength(0);
    expect(prisma._audits.map((a) => a.action)).toContain('agent.form_fill.failed');
    // A7 fail-loud must not fire: a worker handles agent_form_fill.
    expect(prisma._audits.map((a) => a.action)).not.toContain('approval.unexecutable');
    expect(row.failedReason).not.toContain('no worker registered');
  });

  it('dispatches a valid AgentTask to the online device, then marks sent on result', async () => {
    const { worker, approvals, gateway, agents, prisma, device } = harness();
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    // Task row persisted + one push to the online device.
    expect(prisma._tasks).toHaveLength(1);
    expect(gateway._pushed).toHaveLength(1);
    expect(gateway._pushed[0]!.deviceId).toBe(device.id);
    // The envelope parses against the shared desktop-agent schema.
    const envelope = AgentTask.parse(gateway._pushed[0]!.task);
    expect(envelope.kind).toBe('ashby-apply');
    expect(envelope.params).toMatchObject({ url: basePayload().url, mode: 'live' });
    expect((envelope.params as { approvalItemId: string }).approvalItemId).toBe(item.id);
    // Not sent until the device reports back.
    expect(prisma._approvals.find((r) => r.id === item.id)!.state).toBe('approved');

    await agents.recordTaskResult(envelope.id, device.id, 'completed', {
      taskId: envelope.id,
      status: 'ok',
      durationMs: 1200,
    });
    await drain();

    const row = prisma._approvals.find((r) => r.id === item.id)!;
    expect(row.state).toBe('sent');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(prisma._audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['agent.form_fill.dispatched', 'agent.form_fill.sent']),
    );
  });

  it('marks the approval failed with the device reason on a failed result', async () => {
    const { worker, approvals, gateway, agents, prisma, device } = harness();
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();
    const envelope = AgentTask.parse(gateway._pushed[0]!.task);

    await agents.recordTaskResult(envelope.id, device.id, 'failed', {
      taskId: envelope.id,
      status: 'selector-broken',
      failureReason: 'resume_upload selector missing',
      durationMs: 800,
    });
    await drain();

    const row = prisma._approvals.find((r) => r.id === item.id)!;
    expect(row.state).toBe('failed');
    expect(row.failedReason).toContain('resume_upload selector missing');
    expect(prisma._audits.map((a) => a.action)).toContain('agent.form_fill.failed');
  });

  it('refuses to dispatch while the shared kill-switch is active', async () => {
    const { worker, approvals, gateway, prisma } = harness({ paused: true });
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    expect(prisma._approvals.find((r) => r.id === item.id)!.failedReason).toContain('kill-switch');
    expect(gateway._pushed).toHaveLength(0);
  });

  it('refuses to dispatch to a domain outside the form-fill allowlist', async () => {
    const { worker, approvals, gateway, prisma } = harness({ allowlisted: false });
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    expect(prisma._approvals.find((r) => r.id === item.id)!.failedReason).toContain(
      'domain-not-allowlisted',
    );
    expect(gateway._pushed).toHaveLength(0);
  });

  it('refuses employer-confidential payloads', async () => {
    const { worker, approvals, gateway } = harness();
    const item = await worker.enqueue(basePayload({ sensitivity: 'employer-confidential' }));
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    expect(gateway._pushed).toHaveLength(0);
    expect(worker.handles(AGENT_FORM_FILL_APPROVAL_KIND)).toBe(true);
  });

  it('marks the approval failed when the WSS push throws', async () => {
    const { worker, approvals, prisma } = harness({ pushThrows: true });
    const item = await worker.enqueue(basePayload());
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await drain();

    const row = prisma._approvals.find((r) => r.id === item.id)!;
    expect(row.state).toBe('failed');
    expect(row.failedReason).toContain('wss dispatch failed');
    expect(prisma._tasks[0]!.status).toBe('failed');
  });

  it('matchAllowlist honours exact, suffix and wildcard domains', () => {
    const map = new Map<string, never>([
      ['ashbyhq.com', ASHBY_ENTRY as never],
      ['*', ASHBY_ENTRY as never],
    ]);
    expect(matchAllowlist(map, 'ashbyhq.com')).toBeTruthy();
    expect(matchAllowlist(map, 'jobs.ashbyhq.com')).toBeTruthy();
    expect(matchAllowlist(new Map([['*', ASHBY_ENTRY as never]]), 'example.com')).toBeTruthy();
    expect(matchAllowlist(new Map(), 'example.com')).toBeNull();
  });
});
