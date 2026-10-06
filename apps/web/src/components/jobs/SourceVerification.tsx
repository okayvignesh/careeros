'use client';

import { useCallback, useState } from 'react';
import { BadgeCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { JOB_STATE_TONE, listJobs } from '@/lib/jobs';
import {
  type ReVerifyResult,
  listRejectLog,
  reVerifyReject,
} from '@/lib/verification';

const STATES = ['VERIFIED', 'DISCOVERED', 'STALE', 'CLOSED'] as const;

/**
 * Screen 39 source verification. Trust state of every posting comes from the
 * paginated `/jobs` list; rejected postings and the re-verify action come from
 * `/admin/jobs/reject-log`. A rejected row is preserved after a successful
 * promotion (see the controller), so re-verify never deletes history.
 */
export function SourceVerification() {
  const load = useCallback(async () => {
    const [jobs, rejects] = await Promise.all([listJobs(200, 0), listRejectLog({ limit: 50 })]);
    return { jobs, rejects };
  }, []);
  const { data, error, refetch } = useApi(load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReVerifyResult>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  async function onReVerify(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const result = await reVerifyReject(id);
      setResults((r) => ({ ...r, [id]: result }));
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <UnavailableNotice feature="Source verification" testId="verification-unavailable" />;
  if (data === null) return <Loader size={64} label="Loading verification state" />;

  const counts = STATES.map((state) => ({
    state,
    count: data.jobs.jobs.filter((j) => j.state === state).length,
  }));
  const rejects = data.rejects.rows;

  return (
    <div className="flex flex-col gap-8" data-testid="source-verification">
      <section className="flex flex-wrap gap-3" data-testid="verification-summary">
        {counts.map(({ state, count }) => (
          <div
            key={state}
            className="flex min-w-[140px] flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3"
          >
            <span className="text-[11px] uppercase tracking-[0.12em] text-fg-faint">{state}</span>
            <span className="font-mono text-[22px] text-fg tabular-nums">{count}</span>
          </div>
        ))}
        <div className="flex min-w-[140px] flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
          <span className="text-[11px] uppercase tracking-[0.12em] text-fg-faint">Rejected</span>
          <span className="font-mono text-[22px] text-fg tabular-nums" data-testid="verification-rejected-count">
            {data.rejects.total}
          </span>
        </div>
      </section>

      <p className="flex items-start gap-2 text-[12.5px] text-fg-muted">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
        Only VERIFIED postings reach the shortlist or an application path. A stale posting keeps its
        data and match report; it is never deleted.
      </p>

      {actionError && (
        <div role="alert" data-testid="verification-error" className="text-[12.5px] text-danger">
          {actionError}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          <ShieldAlert className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Rejected postings
        </h2>
        {rejects.length === 0 ? (
          <p
            data-testid="verification-empty"
            className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
          >
            No rejections logged. Every ingested posting passed verification.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
            <table className="w-full text-[13px]">
              <thead className="bg-[hsl(var(--bg-elev-1))] text-left text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 font-medium">Rejected</th>
                  <th className="px-4 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rejects.map((row) => {
                  const result = results[row.id];
                  return (
                    <tr
                      key={row.id}
                      data-testid="verification-row"
                      className="border-t border-[hsl(var(--border))]"
                    >
                      <td className="px-4 py-3 font-mono text-[12px] text-fg-muted">{row.sourceName}</td>
                      <td className="px-4 py-3 text-fg">
                        {row.reason}
                        {result && (
                          <span
                            data-testid="verification-result"
                            className={cn(
                              'ml-2 rounded border px-1.5 py-[1px] text-[10.5px] uppercase tracking-[0.08em]',
                              result.promoted
                                ? JOB_STATE_TONE.VERIFIED
                                : 'border-[hsl(var(--border))] text-fg-faint',
                            )}
                          >
                            {result.promoted ? 'promoted' : result.verdict}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-fg-faint">
                        {new Date(row.rejectedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="verification-reverify"
                          disabled={busyId === row.id}
                          onClick={() => onReVerify(row.id)}
                        >
                          {busyId === row.id ? (
                            <>
                              <ThinkingOrb state="working" size={20} /> Re-verifying
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3.5 w-3.5" /> Re-verify
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
