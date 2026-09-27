'use client';

import { Button } from '@careeros/ui';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-10 py-14">
      <div className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-4 py-3 text-[13.5px] text-danger">
        Skill demand failed to load. {error.message}
      </div>
      <div>
        <Button onClick={reset}>Retry</Button>
      </div>
    </main>
  );
}
