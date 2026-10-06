'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, FileText, Mail, RefreshCw, Search, Sliders, Sparkles, Target, X } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface JobListItem {
  id: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  primarySource: string;
  state: string;
  sourcePostedAt: string | null;
  firstSeenAt: string;
  skillIds: string[];
  match: {
    score: number | null;
    matched: number;
    total: number;
    missing: string[];
  };
  aging: boolean;
}

interface SkillExtractionStats {
  scanned: number;
  extracted: number;
  skipped: number;
  errors: number;
}

interface ListResponse {
  jobs: JobListItem[];
  total: number;
  rejected: {
    remoteOnly: number;
    mustHaveMissing: number;
    hasDealbreaker: number;
    companyBlacklisted: number;
    stale: number;
    scanned: number;
  };
}

interface SyncStats {
  adapter: string;
  fetched: number;
  rawInserted: number;
  normalizedInserted: number;
  normalizedUpdated: number;
}

interface AdapterInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  licenseHint: string;
  attribution: string;
}

interface ProviderRow {
  id: string;
  name: string;
  status: 'active' | 'standby';
  authNote: string;
}

export function JobsList() {
  const router = useRouter();
  const search = useSearchParams();
  const skillFilter = search.get('skill') ?? '';
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [providerId, setProviderId] = useState('remotive');
  const [syncing, setSyncing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const [lastFind, setLastFind] = useState<SyncStats | null>(null);
  const [lastExtract, setLastExtract] = useState<SkillExtractionStats | null>(null);

  const load = useCallback(() => {
    const url = skillFilter
      ? `/jobs?limit=50&skill=${encodeURIComponent(skillFilter)}`
      : '/jobs?limit=50';
    return apiGet<ListResponse>(url);
  }, [skillFilter]);
  const { data, error, setError, refetch } = useApi(load);

  useEffect(() => {
    apiGet<AdapterInfo[]>('/admin/jobs/adapters')
      .then(setAdapters)
      .catch(() => setAdapters([]));
  }, []);

  useEffect(() => {
    apiGet<{ providers: ProviderRow[] }>('/me/search-providers')
      .then((r) => {
        setProviders(r.providers);
        setProviderId((cur) =>
          r.providers.some((p) => p.id === cur) ? cur : (r.providers[0]?.id ?? 'remotive'),
        );
      })
      .catch(() => setProviders([]));
  }, []);

  async function extractSkills() {
    setExtracting(true);
    setError(null);
    try {
      const stats = await apiPost<SkillExtractionStats>('/admin/jobs/extract-skills?limit=20');
      setLastExtract(stats);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

  function clearSkillFilter() {
    router.push('/jobs');
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const stats = await apiPost<SyncStats>(`/admin/jobs/sync/${providerId}`);
      setLastSync(stats);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function findJobs() {
    setFinding(true);
    setError(null);
    try {
      const stats = await apiPost<SyncStats>('/admin/jobs/candidate-search', {});
      setLastFind(stats);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const activeSources = new Set(data.jobs.map((j) => j.primarySource));
  const visibleAttributions = adapters.filter((a) => activeSources.has(a.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[13px] text-fg-muted">
          {data.total.toLocaleString()} job{data.total === 1 ? '' : 's'}
        </span>
        <span className="text-[11.5px] text-fg-faint">
          Sorted by match score. Skills come from evidence on your dashboard.
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor="jobs-source" className="sr-only">
            Job source
          </label>
          <select
            id="jobs-source"
            data-testid="jobs-source-select"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none"
          >
            {providers.length === 0 && <option value="remotive">Remotive</option>}
            {providers
              .filter((p) => p.id !== 'firecrawl')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.status === 'standby' ? ' (standby — not configured)' : ''}
                </option>
              ))}
          </select>
          <Button size="sm" variant="ghost" onClick={sync} disabled={syncing}>
            {syncing ? (
              <>
                <ThinkingOrb state="working" size={20} /> Syncing
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" /> Sync
              </>
            )}
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={findJobs} disabled={finding}>
          {finding ? (
            <>
              <ThinkingOrb state="working" size={20} /> Searching
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" /> Find jobs (Firecrawl)
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={extractSkills} disabled={extracting}>
          {extracting ? (
            <>
              <ThinkingOrb state="working" size={20} /> Extracting
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Extract skills (20)
            </>
          )}
        </Button>
        {lastSync && (
          <span className="text-[12px] text-fg-faint">
            Last sync ({lastSync.adapter}): fetched {lastSync.fetched},{' '}
            {lastSync.normalizedInserted} new, {lastSync.normalizedUpdated} updated.
          </span>
        )}
        {lastFind && (
          <span className="text-[12px] text-fg-faint">
            Firecrawl search: {lastFind.rawInserted} discovered, {lastFind.normalizedInserted} new.
          </span>
        )}
        {lastExtract && (
          <span className="text-[12px] text-fg-faint">
            Last extract: {lastExtract.extracted} of {lastExtract.scanned}
            {lastExtract.errors > 0 && `, ${lastExtract.errors} errors`}.
          </span>
        )}
        <Link
          href="/settings/job-preferences"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
        >
          <Sliders className="h-3.5 w-3.5" /> Edit filters
        </Link>
      </div>

      {(() => {
        const r = data.rejected;
        const totalRejected =
          r.remoteOnly + r.mustHaveMissing + r.hasDealbreaker + r.companyBlacklisted + (r.stale ?? 0);
        if (totalRejected === 0) return null;
        const parts = [
          r.remoteOnly && `${r.remoteOnly} not remote`,
          r.mustHaveMissing && `${r.mustHaveMissing} missing a must-have`,
          r.hasDealbreaker && `${r.hasDealbreaker} hit a dealbreaker`,
          r.companyBlacklisted && `${r.companyBlacklisted} blacklisted company`,
          r.stale && `${r.stale} older than 45 days`,
        ].filter(Boolean);
        const pool = data.rejected.scanned ?? totalRejected;
        return (
          <div className="text-[12px] text-fg-faint">
            Filtered {parts.join(', ')} (from {pool.toLocaleString()} scanned in the current page).{' '}
            <Link href="/settings/job-preferences" className="underline hover:text-fg-muted">
              adjust
            </Link>
          </div>
        );
      })()}

      {skillFilter && (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          <span>Filtering by skill:</span>
          <span className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-[1px] font-mono text-[11.5px] text-accent">
            {skillFilter}
            <button
              type="button"
              onClick={clearSkillFilter}
              className="text-accent hover:text-fg"
              aria-label="Clear skill filter"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {visibleAttributions.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 text-[11.5px] text-fg-faint">
          <span className="font-medium uppercase tracking-[0.08em] text-fg-subtle">Sources</span>
          {visibleAttributions.map((a) => (
            <span key={a.id}>{a.attribution}</span>
          ))}
        </div>
      )}

      {data.jobs.length === 0 ? (
        <EmptyState onSync={sync} syncing={syncing} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[hsl(var(--border))]">
          <table className="w-full text-[13px]">
            <thead className="bg-[hsl(var(--bg-elev-1))] text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Match</th>
                <th className="px-4 py-2.5 text-left font-medium">Title</th>
                <th className="px-4 py-2.5 text-left font-medium">Company</th>
                <th className="px-4 py-2.5 text-left font-medium">Location</th>
                <th className="px-4 py-2.5 text-left font-medium">Source</th>
                <th className="px-4 py-2.5 text-left font-medium">Posted</th>
                <th className="sticky right-0 z-10 border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-2.5 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr
                  key={j.id}
                  className="group border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-elev-1))]"
                >
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <MatchCell match={j.match} />
                  </td>
                  <td className="max-w-[320px] px-4 py-2.5 text-fg">
                    <div className="truncate" title={j.title}>
                      {j.title}
                    </div>
                    {j.skillIds.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {j.skillIds.slice(0, 6).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => router.push(`/jobs?skill=${encodeURIComponent(s)}`)}
                            className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-mono text-[10.5px] text-fg-subtle hover:border-accent/40 hover:text-accent"
                          >
                            {s}
                          </button>
                        ))}
                        {j.skillIds.length > 6 && (
                          <span className="text-[10.5px] text-fg-faint">
                            +{j.skillIds.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-fg-muted" title={j.company}>
                    {j.company}
                  </td>
                  <td className="px-4 py-2.5 text-fg-muted">
                    {j.remote && <RemoteBadge />}
                    {j.location && <span className="ml-1.5">{j.location}</span>}
                    {!j.remote && !j.location && <span className="text-fg-faint">-</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11.5px] text-fg-subtle">{j.primarySource}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-fg-faint">
                    {j.sourcePostedAt ? formatDate(j.sourcePostedAt) : '-'}
                    {j.aging && (
                      <span
                        className="ml-1.5 rounded border border-warning/30 bg-warning/10 px-1 py-[1px] text-[10px] font-medium uppercase tracking-wider text-warning"
                        title="Older than 14 days; falls out of the pool at 45 days"
                      >
                        Aging
                      </span>
                    )}
                  </td>
                  <td className="sticky right-0 z-10 whitespace-nowrap border-l border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-2.5 text-right group-hover:bg-[hsl(var(--bg-elev-1))]">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/jobs/${j.id}`}
                        data-testid="job-match-report"
                        className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-[1px] text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-accent"
                      >
                        Match report
                      </Link>
                      <TrackButton jobId={j.id} />
                      <DraftResumeButton jobId={j.id} />
                      <DraftCoverButton jobId={j.id} />
                      <a
                        href={j.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Open <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DraftResumeButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function draft() {
    setBusy(true);
    setErr(null);
    try {
      const variant = await apiPost<{ id: string }>(`/me/resume-variants/for-job/${jobId}`);
      router.push(`/resume-variants/${variant.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={draft}
        disabled={busy}
        title={err ?? 'Generate a resume tailored to this job'}
        className={
          'inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-[1px] text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-accent disabled:opacity-60 ' +
          (err ? 'border-danger/40 text-danger hover:border-danger/40 hover:text-danger' : '')
        }
      >
        <FileText className="h-3 w-3" />
        {busy ? 'Drafting' : err ? 'Retry' : 'Draft resume'}
      </button>
    </span>
  );
}

function TrackButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tracked, setTracked] = useState(false);
  async function track() {
    setBusy(true);
    setErr(null);
    try {
      await apiPost<{ id: string }>(`/me/applications`, { jobId });
      setTracked(true);
      // Small feedback pause, then optionally jump to the tracker.
      setTimeout(() => router.push('/applications'), 600);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={track}
      disabled={busy || tracked}
      title={err ?? 'Track this job in your applications pipeline'}
      className={
        'inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-[1px] text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-accent disabled:opacity-60 ' +
        (err ? 'border-danger/40 text-danger hover:border-danger/40 hover:text-danger' : '')
      }
    >
      <Target className="h-3 w-3" />
      {tracked ? 'Tracking' : busy ? 'Adding' : err ? 'Retry' : 'Track'}
    </button>
  );
}

function DraftCoverButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function draft() {
    setBusy(true);
    setErr(null);
    try {
      const letter = await apiPost<{ id: string }>(`/me/cover-letters/for-job/${jobId}`);
      router.push(`/cover-letters/${letter.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={draft}
      disabled={busy}
      title={err ?? 'Draft a cover letter for this job'}
      className={
        'inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-[1px] text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-accent disabled:opacity-60 ' +
        (err ? 'border-danger/40 text-danger hover:border-danger/40 hover:text-danger' : '')
      }
    >
      <Mail className="h-3 w-3" />
      {busy ? 'Drafting' : err ? 'Retry' : 'Draft cover'}
    </button>
  );
}

function MatchCell({ match }: { match: JobListItem['match'] }) {
  if (match.score === null) {
    return (
      <span className="font-mono text-[11.5px] text-fg-faint" title="Skill extraction pending">
        -
      </span>
    );
  }
  const pct = Math.round(match.score * 100);
  // Tint only kicks in once the required-skill list is large enough for a
  // percentage to be meaningful. Below 3 skills, {0, 33, 50, 67, 100}%
  // buckets snap around too much for color to tell an honest story.
  const canTint = match.total >= 3;
  const tone =
    canTint && match.score >= 0.7
      ? 'border-accent/40 bg-accent/10 text-accent'
      : canTint && match.score >= 0.4
        ? 'border-warning/30 bg-warning/10 text-warning'
        : 'border-[hsl(var(--border))] text-fg-muted';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[11.5px] ${tone}`}
      title={`${match.matched} of ${match.total} required skills`}
    >
      {pct}%
    </span>
  );
}

function RemoteBadge() {
  return (
    <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wider text-accent">
      Remote
    </span>
  );
}

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-12 text-center">
      <p className="text-[13.5px] text-fg-muted">
        No jobs yet. Trigger the first sync to pull from Remotive (public JSON feed, no auth).
      </p>
      <Button size="sm" onClick={onSync} disabled={syncing}>
        {syncing ? (
          <>
            <ThinkingOrb state="working" size={20} /> Syncing
          </>
        ) : (
          <>Run first sync</>
        )}
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-64 animate-pulse rounded bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-64 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

