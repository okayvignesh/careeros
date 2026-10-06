'use client';

import { useCallback, useState } from 'react';
import { Building2, CalendarClock, ExternalLink, RefreshCw, Star } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { ApiError } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { type DossierDto, getDossier, refreshDossier } from '@/lib/jobs';

type DossierState =
  | { kind: 'ok'; dossier: DossierDto }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

/**
 * C-P4.4 company dossier. Reads the cached dossier (`GET /me/dossier/:companyId`)
 * and can rebuild it from public sources (`POST /me/dossier/:companyId/refresh`).
 * Every fact shown carries its source URL.
 */
export function CompanyDossier({ companyId }: { companyId: string }) {
  const load = useCallback(async (): Promise<DossierState> => {
    try {
      return { kind: 'ok', dossier: await getDossier(companyId) };
    } catch (e) {
      // A 404 means no dossier has been built yet — a build affordance, not an error.
      if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
      return { kind: 'error', message: (e as Error).message };
    }
  }, [companyId]);
  const { data, refetch } = useApi<DossierState>(load);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onBuild() {
    setBusy(true);
    setActionError(null);
    try {
      await refreshDossier(companyId);
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data === null) return <Loader size={64} label="Loading dossier" />;
  if (data.kind === 'error') {
    return (
      <div
        role="alert"
        data-testid="dossier-error"
        className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
      >
        Could not load the dossier for {companyId}: {data.message}
      </div>
    );
  }
  if (data.kind === 'missing') {
    return <EmptyDossier companyId={companyId} busy={busy} error={actionError} onBuild={onBuild} />;
  }

  const d = data.dossier;
  const events = [
    ...d.recentEvents.fundingRounds,
    ...d.recentEvents.acquisitions,
    ...d.recentEvents.productLaunches,
    ...d.recentEvents.layoffs,
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="flex flex-col gap-8" data-testid="company-dossier">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-3">
        <div className="flex items-center gap-2 text-[13px] text-fg">
          <Building2 className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
          <span className="font-medium">{d.companyId}</span>
          <span className="text-fg-faint">
            built {new Date(d.generatedAt).toLocaleDateString()} · {d.factRefs.length} cited facts
          </span>
        </div>
        <Button size="sm" variant="secondary" data-testid="dossier-rebuild" onClick={onBuild} disabled={busy}>
          {busy ? (
            <>
              <ThinkingOrb state="searching" size={20} /> Rebuilding
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> Rebuild dossier
            </>
          )}
        </Button>
      </div>

      {actionError && (
        <div role="alert" data-testid="dossier-error" className="text-[12.5px] text-danger">
          {actionError}
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">Synthesis</h2>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg" data-testid="dossier-synthesis">
          {d.synthesis}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12px] text-fg-muted">
          {d.identity.website && (
            <a href={d.identity.website} target="_blank" rel="noopener noreferrer" data-testid="dossier-website" className="inline-flex items-center gap-1 hover:text-accent">
              <ExternalLink className="h-3 w-3" /> {d.identity.website}
            </a>
          )}
          {d.identity.linkedinUrl && (
            <a href={d.identity.linkedinUrl} target="_blank" rel="noopener noreferrer" data-testid="dossier-linkedin" className="inline-flex items-center gap-1 hover:text-accent">
              <ExternalLink className="h-3 w-3" /> LinkedIn
            </a>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-medium text-fg">Technology signals</h2>
        {d.techSignals.stackHints.length === 0 && d.techSignals.engineeringBlogPosts.length === 0 ? (
          <p className="text-[12.5px] text-fg-faint">No technology signals were found in the permitted sources.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {d.techSignals.stackHints.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="dossier-stack">
                {d.techSignals.stackHints.map((s) => (
                  <span key={s} className="rounded border border-[hsl(var(--border))] px-2 py-0.5 font-mono text-[11.5px] text-fg-muted">
                    {s}
                  </span>
                ))}
              </div>
            )}
            {d.techSignals.engineeringBlogPosts.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 hover:border-[hsl(var(--border-active))]"
              >
                <span className="text-[13.5px] text-fg">{p.title}</span>
                <span className="text-[12px] text-fg-muted">{p.summary}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {(d.reviews.ambitionbox || d.reviews.comparably || (d.reviews.reddit?.threads.length ?? 0) > 0) && (
        <section className="flex flex-col gap-3" data-testid="dossier-reviews">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <Star className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Reviews
          </h2>
          <div className="flex flex-wrap gap-3">
            {d.reviews.ambitionbox && (
              <ReviewCard name="AmbitionBox" aggregate={d.reviews.ambitionbox} />
            )}
            {d.reviews.comparably && <ReviewCard name="Comparably" aggregate={d.reviews.comparably} />}
          </div>
          {d.reviews.reddit?.threads.map((t) => (
            <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" data-testid="dossier-reddit-thread" className="text-[12.5px] text-fg-muted hover:text-accent">
              {t.title}
            </a>
          ))}
        </section>
      )}

      {events.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="dossier-events">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <CalendarClock className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Recent events
          </h2>
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={`${e.kind}:${e.url}`} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 text-[13px]">
                <a href={e.url} target="_blank" rel="noopener noreferrer" data-testid="dossier-event-link" className="text-fg hover:text-accent">
                  {e.headline}
                </a>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.1em] text-fg-faint">{e.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReviewCard({ name, aggregate }: { name: string; aggregate: { rating: number; count: number; url: string } }) {
  return (
    <a
      href={aggregate.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-[180px] flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-3 hover:border-[hsl(var(--border-active))]"
    >
      <span className="text-[12px] text-fg-subtle">{name}</span>
      <span className="font-mono text-[20px] text-fg tabular-nums">{aggregate.rating.toFixed(1)}</span>
      <span className="text-[11.5px] text-fg-faint">{aggregate.count} reviews</span>
    </a>
  );
}

function EmptyDossier({
  companyId,
  busy,
  error,
  onBuild,
}: {
  companyId: string;
  busy: boolean;
  error: string | null;
  onBuild: () => void;
}) {
  return (
    <div
      data-testid="dossier-empty"
      className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-12 text-center"
    >
      <p className="max-w-xl text-[13.5px] text-fg-muted">
        No dossier has been built for {companyId} yet. Building one fetches public sources (identity,
        engineering blog, permitted review aggregates) and synthesises only what those sources state.
      </p>
      {error && (
        <p role="alert" data-testid="dossier-error" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <Button data-testid="dossier-build" onClick={onBuild} disabled={busy}>
        {busy ? (
          <>
            <ThinkingOrb state="searching" size={20} /> Building
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" /> Build dossier
          </>
        )}
      </Button>
    </div>
  );
}
