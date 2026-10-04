'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Play, Send } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import { type LatestBrief, briefToPlainText, getLatestBrief, previewBrief } from '@/lib/notifications';

/**
 * Screen 49 daily brief: the plain-text message the daily assistant delivers,
 * grounded in the real `/brief/latest` audit trail and the on-demand
 * `/brief/preview` composer. Scheduling lives on `/settings/notifications`.
 */
export function DailyBriefPanel() {
  const load = useCallback(() => getLatestBrief(10), []);
  const { data: deliveries, error, refetch } = useApi(load);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onPreview() {
    setPreviewBusy(true);
    setActionError(null);
    try {
      setPreviewText(briefToPlainText(await previewBrief()));
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }

  if (error) return <UnavailableNotice feature="Daily brief" testId="daily-brief-unavailable" />;

  return (
    <div className="flex flex-col gap-6" data-testid="daily-brief-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="daily-brief-preview" onClick={onPreview} disabled={previewBusy}>
          {previewBusy ? (
            <>
              <ThinkingOrb state="composing" size={20} /> Composing
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Compose a test brief
            </>
          )}
        </Button>
        <Link
          href="/settings/notifications"
          data-testid="daily-brief-schedule-link"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[13px] text-fg-muted hover:border-accent/50 hover:text-accent"
        >
          <CalendarClock className="h-4 w-4" /> Edit schedule
        </Link>
      </div>

      {actionError && (
        <div role="alert" data-testid="daily-brief-error" className="text-[12.5px] text-danger">
          {actionError}
        </div>
      )}

      {previewText && (
        <section className="flex flex-col gap-2" data-testid="daily-brief-preview-text">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            Preview · not delivered
          </h2>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-5 py-4 font-mono text-[12.5px] leading-relaxed text-fg-muted">
            {previewText}
          </pre>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          <Send className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Recent deliveries
        </h2>
        {deliveries === null ? (
          <Loader size={64} label="Loading deliveries" />
        ) : deliveries.length === 0 ? (
          <p
            data-testid="daily-brief-empty"
            className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
          >
            No brief has been delivered yet. Turn it on and set a schedule, or compose a test above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="daily-brief-list">
            {deliveries.map((delivery) => (
              <DeliveryRow key={delivery.id} delivery={delivery} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: LatestBrief }) {
  return (
    <li
      data-testid="daily-brief-row"
      className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
    >
      <details>
        <summary className="cursor-pointer text-[13px] text-fg">
          Delivered {new Date(delivery.composedAt).toLocaleString()}
        </summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-fg-muted">
          {delivery.payload
            ? briefToPlainText(delivery.payload)
            : 'Payload not captured for this delivery.'}
        </pre>
      </details>
    </li>
  );
}
