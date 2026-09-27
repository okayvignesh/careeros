import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button, Eyebrow } from '@careeros/ui';

export default function NotFound() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-start justify-center gap-6 px-6 py-16">
      <Eyebrow>404 · Not found</Eyebrow>
      <h1 className="text-[72px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-fg-faint">
        404
      </h1>
      <p className="text-[15px] text-fg-muted">The page you were looking for isn&apos;t here.</p>
      <Link href="/">
        <Button variant="secondary" size="sm">
          <ArrowLeft className="h-4 w-4" /> Home
        </Button>
      </Link>
    </main>
  );
}
