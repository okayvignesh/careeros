import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppNav } from '@/components/AppNav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col gap-8 border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))/0.4] px-5 py-8">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[hsl(var(--accent))] text-[13px] font-semibold text-[hsl(var(--accent-fg))]">
            C
          </span>
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Career OS</span>
        </Link>
        <AppNav />
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
