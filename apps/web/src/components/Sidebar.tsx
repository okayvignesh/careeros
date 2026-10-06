'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { AppNav } from '@/components/AppNav';
import { BrandMark, BrandWordmark } from '@/components/Brand';
import { createLocalStore, useLocalStore } from '@/lib/persisted-state';

const sidebarCollapsedStore = createLocalStore<boolean>('careeros:sidebar-collapsed', false);

/**
 * App sidebar. Two collapse levels:
 *  - per group: handled inside AppNav (each section header toggles its list),
 *  - the whole sidebar: this component shrinks it to a thin rail with a single
 *    expand control, giving the content full width.
 * Ends with a log-out control pinned to the bottom.
 */
export function Sidebar() {
  const router = useRouter();
  const [collapsed, setCollapsed] = useLocalStore(sidebarCollapsedStore);
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    setSigningOut(true);
    try {
      await apiPost('/auth/sign-out', {});
    } catch {
      // Even if the call fails, drop the user at the sign-in screen.
    } finally {
      router.push('/sign-in');
      router.refresh();
    }
  }

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))/0.4] transition-[width,padding] duration-[var(--dur)]',
        collapsed ? 'w-[64px] gap-4 px-3 py-7' : 'w-[240px] gap-6 px-5 py-8',
      )}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-4">
          <Link href="/dashboard" aria-label="Career OS home">
            <BrandMark className="h-6 w-6" alt="Career OS" />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            data-testid="sidebar-expand"
            className="rounded-md p-2 text-fg-subtle transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            onClick={logout}
            disabled={signingOut}
            aria-label="Log out"
            data-testid="sidebar-logout"
            className="mt-auto rounded-md p-2 text-fg-subtle transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              aria-label="Career OS home"
              className="flex items-center px-1"
            >
              <BrandWordmark alt="" className="h-6" />
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              data-testid="sidebar-collapse"
              className="rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>
          <AppNav />
          <div className="border-t border-[hsl(var(--border))] pt-3">
            <button
              type="button"
              onClick={logout}
              disabled={signingOut}
              data-testid="sidebar-logout"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-[hsl(var(--bg-hover))/0.5] hover:text-fg disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.7} />
              {signingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
