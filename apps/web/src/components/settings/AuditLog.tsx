'use client';

import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { Loader } from '@/components/Loader';

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface AuditPage {
  total: number;
  offset: number;
  limit: number;
  rows: AuditRow[];
}

export interface AuditFilters {
  actor: string;
  action: string;
  resourceType: string;
  from: string;
  to: string;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 50;

/** Serialize the viewer's filters into the `/me/audit` query string. Pure. */
export function buildAuditQuery(f: AuditFilters): string {
  const params = new URLSearchParams();
  params.set('limit', String(f.limit));
  params.set('offset', String(f.offset));
  if (f.actor) params.set('actor', f.actor);
  if (f.action) params.set('action', f.action);
  if (f.resourceType) params.set('resourceType', f.resourceType);
  if (f.from) params.set('from', `${f.from}T00:00:00.000Z`);
  if (f.to) params.set('to', `${f.to}T23:59:59.999Z`);
  return params.toString();
}

const ACTORS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any actor' },
  { value: 'user', label: 'You' },
  { value: 'system', label: 'System' },
  { value: 'agent', label: 'Agent' },
];

export function AuditLog() {
  const [actor, setActor] = useState('');
  // Text filters apply on submit so typing doesn't fire a request per keystroke.
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actionDraft, setActionDraft] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    () =>
      apiGet<AuditPage>(
        `/me/audit?${buildAuditQuery({ actor, action, resourceType, from, to, offset, limit: PAGE_SIZE })}`,
      ),
    [actor, action, resourceType, from, to, offset],
  );
  const { data, error, refetch } = useApi(load);

  function applyFilter(next: Partial<Pick<AuditFilters, 'actor' | 'action' | 'resourceType' | 'from' | 'to'>>) {
    if (next.actor !== undefined) setActor(next.actor);
    if (next.action !== undefined) { setAction(next.action); setActionDraft(next.action); }
    if (next.resourceType !== undefined) { setResourceType(next.resourceType); setSourceDraft(next.resourceType); }
    if (next.from !== undefined) setFrom(next.from);
    if (next.to !== undefined) setTo(next.to);
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const rows = data?.rows ?? null;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilter({ action: actionDraft, resourceType: sourceDraft });
        }}
      >
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.1em] text-fg-faint">
          Actor
          <select
            value={actor}
            onChange={(e) => applyFilter({ actor: e.target.value })}
            data-testid="audit-filter-actor"
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] normal-case tracking-normal text-fg focus:border-accent focus:outline-none"
          >
            {ACTORS.map((a) => (
              <option key={a.value || 'any'} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.1em] text-fg-faint">
          Action
          <input
            value={actionDraft}
            onChange={(e) => setActionDraft(e.target.value)}
            placeholder="e.g. approval"
            data-testid="audit-filter-action"
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] normal-case tracking-normal text-fg focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.1em] text-fg-faint">
          Source
          <input
            value={sourceDraft}
            onChange={(e) => setSourceDraft(e.target.value)}
            placeholder="e.g. approval_item"
            data-testid="audit-filter-source"
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] normal-case tracking-normal text-fg focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.1em] text-fg-faint">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => applyFilter({ from: e.target.value })}
            data-testid="audit-filter-from"
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] normal-case tracking-normal text-fg focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.1em] text-fg-faint">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => applyFilter({ to: e.target.value })}
            data-testid="audit-filter-to"
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2.5 py-1.5 text-[12.5px] normal-case tracking-normal text-fg focus:border-accent focus:outline-none"
          />
        </label>
        <Button type="submit" variant="secondary" size="sm" data-testid="audit-apply">
          Apply
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </form>

      {error && (
        <div
          role="alert"
          data-testid="audit-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]">
          <Loader label="Loading audit log" />
        </div>
      ) : rows.length === 0 ? (
        <p
          data-testid="audit-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-12 text-center text-[13px] text-fg-muted"
        >
          No audit events match these filters.
        </p>
      ) : (
        <AuditTable rows={rows} />
      )}

      <div className="flex items-center justify-between text-[12px] text-fg-faint">
        <span data-testid="audit-range" className="tabular-nums">
          {total === 0 ? '0 records' : `${start}–${end} of ${total} records`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            data-testid="audit-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} /> Newer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={end >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            data-testid="audit-next"
          >
            Older <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
      <table className="w-full text-[12.5px]">
        <thead className="bg-[hsl(var(--bg-elev-1))] text-[10.5px] uppercase tracking-[0.1em] text-fg-faint">
          <tr>
            <th className="px-4 py-2 text-left font-medium">When</th>
            <th className="px-4 py-2 text-left font-medium">Actor</th>
            <th className="px-4 py-2 text-left font-medium">Action</th>
            <th className="px-4 py-2 text-left font-medium">Source</th>
            <th className="px-4 py-2 text-left font-medium">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">
          {rows.map((r) => (
            <tr key={r.id} className="align-top" data-testid="audit-row">
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
                <time dateTime={r.timestamp}>{formatDateTime(r.timestamp)}</time>
              </td>
              <td className="px-4 py-2 text-fg-muted">{r.actor}</td>
              <td className="px-4 py-2 font-mono text-[12px] text-fg">{r.action}</td>
              <td className="px-4 py-2 text-fg-muted">
                {r.resourceType ?? '–'}
                {r.resourceId && (
                  <span className="ml-1 font-mono text-[11px] text-fg-faint">
                    {r.resourceId.slice(0, 8)}
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                {r.payload == null ? (
                  <span className="text-fg-faint">–</span>
                ) : (
                  <details data-testid="audit-payload">
                    <summary className="cursor-pointer text-fg-subtle hover:text-fg">Detail</summary>
                    <pre className="mt-2 max-w-[420px] overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-muted">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
