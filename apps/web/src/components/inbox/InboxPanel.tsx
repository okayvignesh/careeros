'use client';

import { useCallback, useMemo, useState } from 'react';
import { Link2, Mail, Trash2, Unlink } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import {
  ACTION_CLASSES,
  type ApplicationOption,
  type InboxItem,
  classLabel,
  dismissInboxItem,
  linkInboxItem,
  listApplications,
  listInbox,
  unlinkInboxItem,
} from '@/lib/inbox';

type Tab = 'all' | 'action' | 'recruiter' | 'interview_invite' | 'rejection' | 'other';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Needs action' },
  { key: 'recruiter', label: 'Recruiter' },
  { key: 'interview_invite', label: 'Interview' },
  { key: 'rejection', label: 'Rejection' },
  { key: 'other', label: 'Other' },
];

/**
 * E.7 inbox triage: recruiter mail, interview invitations and rejections,
 * linked to the applications they belong to. Link/unlink/dismiss are the real
 * `/inbox/*` mutations; the application picker reads `/me/applications`.
 */
export function InboxPanel() {
  const load = useCallback(async () => {
    const [items, applications] = await Promise.all([listInbox({ limit: 200 }), listApplications()]);
    return { items, applications };
  }, []);
  const { data, error, refetch } = useApi(load);

  const [tab, setTab] = useState<Tab>('all');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const applications = useMemo(() => data?.applications ?? [], [data]);

  const counts = useMemo(() => {
    const base: Record<Tab, number> = {
      all: items.length,
      action: items.filter((i) => (ACTION_CLASSES as readonly string[]).includes(i.class)).length,
      recruiter: items.filter((i) => i.class === 'recruiter').length,
      interview_invite: items.filter((i) => i.class === 'interview_invite').length,
      rejection: items.filter((i) => i.class === 'rejection').length,
      other: items.filter(
        (i) =>
          !(ACTION_CLASSES as readonly string[]).includes(i.class) &&
          !['recruiter', 'interview_invite', 'rejection'].includes(i.class),
      ).length,
    };
    return base;
  }, [items]);

  const visible = useMemo(() => {
    if (tab === 'all') return items;
    if (tab === 'action')
      return items.filter((i) => (ACTION_CLASSES as readonly string[]).includes(i.class));
    if (tab === 'other')
      return items.filter(
        (i) =>
          !(ACTION_CLASSES as readonly string[]).includes(i.class) &&
          !['recruiter', 'interview_invite', 'rejection'].includes(i.class),
      );
    return items.filter((i) => i.class === tab);
  }, [items, tab]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <UnavailableNotice feature="Inbox triage" testId="inbox-unavailable" />;
  if (data === null) return <Loader size={64} label="Loading inbox" />;

  const appById = new Map(applications.map((a) => [a.id, a]));

  return (
    <div className="flex flex-col gap-5" data-testid="inbox-panel">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Inbox filters">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`inbox-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
              tab === t.key
                ? 'border-[hsl(var(--border-active))] bg-[hsl(var(--bg-elev-2))] text-fg'
                : 'border-[hsl(var(--border))] text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-[11px] text-fg-faint tabular-nums">
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {actionError && (
        <div role="alert" data-testid="inbox-action-error" className="text-[12.5px] text-danger">
          {actionError}
        </div>
      )}

      {visible.length === 0 ? (
        <p
          data-testid="inbox-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          {items.length === 0
            ? 'No classified mail yet. Mail arrives through the mailbox watch; everything else is left alone.'
            : 'Nothing in this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              linked={item.linkedApplicationId ? (appById.get(item.linkedApplicationId) ?? null) : null}
              applications={applications}
              selectedAppId={selected[item.id] ?? ''}
              busy={busyId === item.id}
              onSelect={(appId) => setSelected((s) => ({ ...s, [item.id]: appId }))}
              onLink={() => {
                const appId = selected[item.id];
                if (appId) void act(item.id, () => linkInboxItem(item.id, appId));
              }}
              onUnlink={() => void act(item.id, () => unlinkInboxItem(item.id))}
              onDismiss={() => void act(item.id, () => dismissInboxItem(item.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  linked,
  applications,
  selectedAppId,
  busy,
  onSelect,
  onLink,
  onUnlink,
  onDismiss,
}: {
  item: InboxItem;
  linked: ApplicationOption | null;
  applications: ApplicationOption[];
  selectedAppId: string;
  busy: boolean;
  onSelect: (appId: string) => void;
  onLink: () => void;
  onUnlink: () => void;
  onDismiss: () => void;
}) {
  const attention = (ACTION_CLASSES as readonly string[]).includes(item.class);
  return (
    <li
      data-testid="inbox-row"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
            <span className="truncate text-[14px] font-medium text-fg">{item.subject}</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em]',
                attention
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-[hsl(var(--border))] text-fg-subtle',
              )}
            >
              {classLabel(item.class)}
            </span>
          </div>
          <span className="text-[12.5px] text-fg-muted">
            {item.fromAddress} · {new Date(item.arrivedAt).toLocaleString()} ·{' '}
            {Math.round(item.classConfidence * 100)}% confidence
          </span>
          {item.snippet && <span className="text-[12.5px] text-fg-faint">{item.snippet}</span>}
          <span className="text-[12px] text-fg-subtle">
            {linked
              ? `Linked to ${linked.jobTitle ?? 'application'}${linked.jobCompany ? ` @ ${linked.jobCompany}` : ''}`
              : 'Not linked'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linked ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="inbox-unlink"
              disabled={busy}
              onClick={onUnlink}
            >
              <Unlink className="h-4 w-4" /> Unlink
            </Button>
          ) : (
            <>
              <select
                data-testid="inbox-app-select"
                value={selectedAppId}
                onChange={(e) => onSelect(e.target.value)}
                aria-label={`Application to link ${item.subject}`}
                className="h-8 max-w-[220px] rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-2 text-[12.5px] text-fg focus:border-accent focus:outline-none"
              >
                <option value="">Choose application…</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.jobTitle ?? a.id}
                    {a.jobCompany ? ` @ ${a.jobCompany}` : ''}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                data-testid="inbox-link"
                disabled={busy || !selectedAppId}
                onClick={onLink}
              >
                {busy ? (
                  <ThinkingOrb state="working" size={20} />
                ) : (
                  <>
                    <Link2 className="h-4 w-4" /> Link
                  </>
                )}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            data-testid="inbox-dismiss"
            disabled={busy}
            onClick={onDismiss}
          >
            <Trash2 className="h-4 w-4" /> Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}
