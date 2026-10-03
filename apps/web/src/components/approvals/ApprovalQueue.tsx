'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, Check, Lock, X } from 'lucide-react';
import { Button, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { Loader } from '@/components/Loader';

export type ApprovalState = 'pending' | 'approved' | 'sent' | 'failed' | 'cancelled';

export interface ApprovalItem {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  diffJson: unknown;
  state: ApprovalState;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  failedReason: string | null;
}

interface ListPage {
  items: ApprovalItem[];
  nextCursor: string | null;
}

const TABS: Array<{ id: string; label: string; testId: string }> = [
  { id: 'pending', label: 'Pending', testId: 'approvals-tab-pending' },
  { id: 'approved', label: 'Approved', testId: 'approvals-tab-approved' },
  { id: 'failed', label: 'Failed', testId: 'approvals-tab-failed' },
  { id: '', label: 'All', testId: 'approvals-tab-all' },
];

/** A 403 from the approvals gate reads `Fresh re-authentication required`. */
export function needsFreshReauth(message: string): boolean {
  return /fresh re-?auth/i.test(message);
}

const KIND_LABEL: Record<string, string> = {
  ats_submit: 'Submit application',
  agent_form_fill: 'Agent form fill',
  outreach_email: 'Send outreach email',
  slack_dm: 'Slack DM',
  delete_account: 'Delete account',
};

export function approvalKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function ApprovalQueue() {
  const [stateFilter, setStateFilter] = useState<string>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [reauthFor, setReauthFor] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiGet<ListPage>(
        `/me/approvals?limit=100${stateFilter ? `&state=${stateFilter}` : ''}`,
      ),
    [stateFilter],
  );
  const { data, error, setError, refetch } = useApi(load);
  const items = data?.items ?? null;

  async function approve(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiPost(`/me/approvals/${id}/approve`);
      setConfirming(null);
      await refetch();
    } catch (e) {
      const msg = (e as Error).message;
      if (needsFreshReauth(msg)) {
        setReauthFor(id);
        setReauthError(null);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiPost(`/me/approvals/${id}/cancel`, rejectReason ? { reason: rejectReason } : {});
      setConfirming(null);
      setRejectReason('');
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitReauth() {
    setReauthBusy(true);
    setReauthError(null);
    try {
      await apiPost('/me/approvals/reauth', { password: reauthPassword });
      const itemId = reauthFor;
      setReauthFor(null);
      setReauthPassword('');
      if (itemId) await approve(itemId);
    } catch (e) {
      setReauthError((e as Error).message);
    } finally {
      setReauthBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-0.5 text-[12.5px]">
          {TABS.map((t) => (
            <button
              key={t.id || 'all'}
              onClick={() => setStateFilter(t.id)}
              data-testid={t.testId}
              aria-pressed={stateFilter === t.id}
              className={cn(
                'rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors duration-[var(--dur-fast)]',
                stateFilter === t.id
                  ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="approvals-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {error}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          data-testid="approvals-action-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {actionError}
        </div>
      )}

      {reauthFor && (
        <div
          role="alert"
          data-testid="approvals-reauth-required"
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-warning/40 bg-warning/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[13px] text-warning">
            <Lock className="h-4 w-4" strokeWidth={1.8} />
            This action needs a fresh re-authentication. Confirm your password to continue — the
            approval is not sent until you do.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="current-password"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && reauthPassword) void submitReauth();
              }}
              aria-label="Password to re-authenticate"
              data-testid="approvals-reauth-password"
              className="min-w-[200px] flex-1 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-3 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={reauthBusy || !reauthPassword}
              onClick={() => void submitReauth()}
              data-testid="approvals-reauth-submit"
            >
              {reauthBusy ? 'Verifying…' : 'Re-authenticate'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReauthFor(null);
                setReauthPassword('');
                setReauthError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {reauthError && (
            <span className="text-[12px] text-danger" data-testid="approvals-reauth-error">
              {reauthError}
            </span>
          )}
        </div>
      )}

      {items === null ? (
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <Loader label="Loading approvals" />
        </div>
      ) : items.length === 0 ? (
        <p
          data-testid="approvals-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-12 text-center text-[13px] text-fg-muted"
        >
          Nothing in this queue. Nothing is sent without your approval.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              confirming={confirming === item.id}
              rejectReason={rejectReason}
              onAskConfirm={() => {
                setConfirming(item.id);
                setRejectReason('');
              }}
              onCancelConfirm={() => setConfirming(null)}
              onRejectReason={setRejectReason}
              onApprove={() => void approve(item.id)}
              onReject={() => void reject(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({
  item,
  busy,
  confirming,
  rejectReason,
  onAskConfirm,
  onCancelConfirm,
  onRejectReason,
  onApprove,
  onReject,
}: {
  item: ApprovalItem;
  busy: boolean;
  confirming: boolean;
  rejectReason: string;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onRejectReason: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const irreversible = item.kind === 'delete_account';
  return (
    <article
      data-testid="approval-item"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[15px] font-medium text-fg">
            {approvalKindLabel(item.kind)}
            {irreversible && (
              <span
                data-testid="approval-irreversible"
                className="inline-flex items-center gap-1 rounded border border-danger/40 bg-danger/10 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wider text-danger"
              >
                <AlertTriangle className="h-3 w-3" strokeWidth={1.8} /> Irreversible
              </span>
            )}
          </div>
          <span className="text-[11.5px] text-fg-faint">
            {item.kind} · queued {formatDateTime(item.createdAt)}
            {item.decidedAt ? ` · decided ${formatDateTime(item.decidedAt)}` : ''}
            {item.sentAt ? ` · sent ${formatDateTime(item.sentAt)}` : ''}
          </span>
        </div>
        <StateBadge state={item.state} />
      </div>

      <ApprovalPayload payload={item.payload} />

      {item.failedReason && (
        <p data-testid="approval-failed-reason" className="text-[12.5px] text-danger">
          Failed: {item.failedReason}
        </p>
      )}

      {item.state === 'pending' &&
        (confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] text-fg-muted">
              {irreversible
                ? 'This cannot be recalled. Confirm you want to approve it.'
                : 'Reject this action? Add an optional reason.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => onRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                aria-label="Rejection reason"
                className="min-w-[180px] flex-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none"
              />
              <Button size="sm" variant="primary" disabled={busy} onClick={onApprove} data-testid="approval-confirm-approve">
                <Check className="h-3.5 w-3.5" strokeWidth={2} /> Confirm approve
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={onReject} data-testid="approval-confirm-reject">
                <X className="h-3.5 w-3.5" strokeWidth={2} /> Confirm reject
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancelConfirm}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={onAskConfirm} data-testid="approval-approve">
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> Approve
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onAskConfirm} data-testid="approval-reject">
              <X className="h-3.5 w-3.5" strokeWidth={2} /> Reject
            </Button>
          </div>
        ))}
    </article>
  );
}

function ApprovalPayload({ payload }: { payload: unknown }) {
  if (payload == null) return null;
  return (
    <details data-testid="approval-payload" className="text-[12px] text-fg-muted">
      <summary className="cursor-pointer text-fg-subtle hover:text-fg">What approving this does</summary>
      <pre className="mt-2 overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-fg-muted">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

function StateBadge({ state }: { state: ApprovalState }) {
  const tone: Record<ApprovalState, string> = {
    pending: 'border-warning/30 bg-warning/10 text-warning',
    approved: 'border-accent/40 bg-accent/10 text-accent',
    sent: 'border-success/40 bg-success/10 text-success',
    failed: 'border-danger/30 bg-danger/10 text-danger',
    cancelled: 'border-[hsl(var(--border))] text-fg-faint',
  };
  return (
    <span
      data-testid="approval-state-badge"
      className={`rounded border px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wider ${tone[state]}`}
    >
      {state}
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
