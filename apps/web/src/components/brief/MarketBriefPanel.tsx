'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface BriefStats {
  windowDays: number;
  totalCount: number;
  newCount: number;
  remoteShare: number;
  topSkills: Array<{ skillId: string; count: number }>;
  topCompanies: Array<{ company: string; count: number }>;
}

interface BriefSection {
  heading: string;
  body: string;
  sourceUrls: string[];
}

interface BriefContent {
  sections: BriefSection[];
}

interface BriefSource {
  kind: 'job';
  ref: string;
  url: string;
}

interface Brief {
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  stats: BriefStats;
  content: BriefContent;
  sources: BriefSource[];
}

type BriefResponse = Brief | { empty: true };

export function MarketBriefPanel() {
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => apiGet<BriefResponse>('/me/market-brief/latest'), []);
  const { data, error, setData, setError } = useApi(load);
  const brief = data && !('empty' in data) ? data : null;
  const empty = !!data && 'empty' in data;

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const fresh = await apiPost<Brief>('/me/market-brief/generate');
      setData(fresh);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  if (error && !brief) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button onClick={generate} disabled={generating}>
          {generating ? (
            <>
              <ThinkingOrb state="working" size={20} /> Generating
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> {brief ? 'Regenerate' : 'Generate brief'}
            </>
          )}
        </Button>
        {brief && (
          <span className="font-mono text-[11.5px] text-fg-faint">
            Last generated {new Date(brief.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && brief && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      {empty && !brief && (
        <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center">
          <p className="text-[13.5px] text-fg-muted">
            No brief yet. Sync jobs, set your preferences, then generate.
          </p>
        </div>
      )}

      {brief && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <Kpi label="Jobs in pool" value={brief.stats.totalCount.toLocaleString()} hint={`${brief.stats.windowDays}-day window`} />
            <Kpi label="New this window" value={brief.stats.newCount.toLocaleString()} hint="" />
            <Kpi label="Remote share" value={`${Math.round(brief.stats.remoteShare * 100)}%`} hint="" />
            <Kpi label="Top skills" value={brief.stats.topSkills.length.toString()} hint={brief.stats.topSkills.slice(0, 3).map((s) => s.skillId).join(', ')} />
          </section>

          <section className="flex flex-col gap-6">
            {brief.content.sections.map((sec, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
                <h2 className="text-[16px] font-medium text-fg">{sec.heading}</h2>
                <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">{sec.body}</p>
                {sec.sourceUrls.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2 text-[11.5px]">
                    <span className="font-medium uppercase tracking-[0.08em] text-fg-subtle">Sources</span>
                    {sec.sourceUrls.map((u) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-accent hover:underline"
                      >
                        {shortUrl(u)} <ArrowUpRight className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>

          <details className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
            <summary className="cursor-pointer text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
              Raw stats
            </summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <BarTable title="Top skills" rows={brief.stats.topSkills.map((s) => ({ label: s.skillId, count: s.count }))} />
              <BarTable title="Top companies" rows={brief.stats.topCompanies.map((c) => ({ label: c.company, count: c.count }))} />
            </div>
          </details>
        </>
      )}

      <Link href="/settings/job-preferences" className="text-[12px] text-fg-faint hover:text-fg-muted">
        Brief is scoped to your job preferences. Edit filters.
      </Link>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">{label}</span>
      <span className="font-mono text-[22px] font-medium text-fg">{value}</span>
      {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
    </div>
  );
}

function BarTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">{title}</div>
      {rows.length === 0 ? (
        <span className="text-[12px] text-fg-faint">Nothing to show yet.</span>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[12px]">
              <div className="truncate text-fg-muted">{r.label}</div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded bg-[hsl(var(--bg))]">
                  <div className="h-full bg-accent" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-mono text-fg-faint">{r.count}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, '') + url.pathname.slice(0, 30);
  } catch {
    return u;
  }
}
