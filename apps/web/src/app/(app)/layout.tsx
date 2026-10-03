import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppNav } from '@/components/AppNav';
import { BrandWordmark } from '@/components/Brand';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col gap-8 border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))/0.4] px-5 py-8">
        <Link href="/dashboard" aria-label="Career OS home" className="flex items-center px-1">
          <BrandWordmark alt="" className="h-6" />
        </Link>
        <AppNav />
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
