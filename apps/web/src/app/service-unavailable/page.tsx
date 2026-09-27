import { Eyebrow } from '@careeros/ui';

export default function ServiceUnavailablePage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-start justify-center gap-6 px-6 py-16">
      <Eyebrow>503 · Service unavailable</Eyebrow>
      <h1 className="text-[72px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-fg-faint">
        503
      </h1>
      <p className="text-[15px] text-fg-muted">
        One or more services are down. Try again shortly, or check container logs.
      </p>
      <code className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-3 py-2 font-mono text-[12.5px] text-fg-muted">
        docker compose logs api
      </code>
    </main>
  );
}
