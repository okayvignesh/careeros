'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Briefcase, FileCheck, LayoutDashboard, MonitorSmartphone, Newspaper, Receipt, ScrollText, Settings, ShieldCheck, Swords, Target, Wrench } from 'lucide-react';
import { cn } from '@careeros/ui';

const groups = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/skills', label: 'Skills', icon: Wrench },
      { href: '/arena', label: 'Arena', icon: Swords },
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/applications', label: 'Applications', icon: Target },
      { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
      { href: '/brief', label: 'Market brief', icon: Newspaper },
      { href: '/evidence', label: 'Evidence', icon: Activity },
      { href: '/facts', label: 'Fact base', icon: FileCheck },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings', label: 'Overview', icon: Settings },
      { href: '/settings/usage', label: 'Usage & costs', icon: Receipt },
      { href: '/settings/integrations', label: 'Integrations', icon: Activity },
      { href: '/settings/devices', label: 'Devices', icon: MonitorSmartphone },
      { href: '/settings/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-6 text-[13px]">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1.5">
          <div className="px-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-faint">
            {g.label}
          </div>
          <ul className="flex flex-col">
            {g.items.map(({ href, label, icon: Icon }) => {
              // Exact match for index routes; startsWith for nested (but only when there's a child segment).
              const isIndex = href === '/dashboard' || href === '/settings';
              const active = isIndex
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-[var(--dur-fast)]',
                      active
                        ? 'bg-[hsl(var(--bg-elev-2))] text-fg'
                        : 'text-fg-muted hover:bg-[hsl(var(--bg-hover))/0.5] hover:text-fg',
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.7} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
