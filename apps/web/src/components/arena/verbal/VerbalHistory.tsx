'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@careeros/ui';
import { useApi } from '@/lib/use-api';
import { listVerbalSessions } from '@/lib/verbal-assessments';
import { VerbalSessionsList } from './VerbalSessionsList';

/** History panel: reads real sessions; skeleton, empty, and error are distinct. */
export function VerbalHistory() {
  const load = useCallback(() => listVerbalSessions(20), []);
  const { data, error, loading } = useApi(load);

  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div
        data-testid="verbal-history-error"
        className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
      >
        {error}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <VerbalSessionsList sessions={data ?? []} />
      <div>
        <Link href="/arena/verbal">
          <Button variant="ghost">Record a spoken answer</Button>
        </Link>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[76px] animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]"
        />
      ))}
    </div>
  );
}
