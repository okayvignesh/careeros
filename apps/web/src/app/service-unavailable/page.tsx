'use client';

import { useSearchParams } from 'next/navigation';
import { Button, Eyebrow } from '@careeros/ui';

/**
 * Shown when the web middleware cannot reach the API. Retry bounces back to
 * the URL the user originally requested (?next=), or / if none was preserved.
 */
export default function ServiceUnavailablePage() {
  const params = useSearchParams();
  const rawNext = params.get('next');
  // Only accept same-origin relative paths, avoid open-redirect via ?next=//evil.
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-start justify-center gap-6 px-6 py-16">
      <Eyebrow>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 motion-safe:animate-pulse"
          />
          careeros · api unreachable
        </span>
      </Eyebrow>
      <h1 className="text-[72px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-fg-faint">
        503
      </h1>
      <p className="text-[15px] text-fg-muted">
        The API is not responding. Try again in a moment, or check that the api container is up.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={() => (window.location.href = next)}>
          Retry
        </Button>
        <code className="font-mono text-[12px] text-fg-faint">docker compose logs api</code>
      </div>
    </main>
  );
}
