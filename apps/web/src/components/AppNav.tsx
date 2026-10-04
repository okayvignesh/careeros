'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  Briefcase,
  Cpu,
  DatabaseBackup,
  FileCheck,
  FolderGit2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MonitorSmartphone,
  Newspaper,
  Receipt,
  Rss,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Swords,
  Target,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { cn } from '@careeros/ui';

const groups = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/skills', label: 'Skills', icon: Wrench },
      { href: '/arena', label: 'Arena', icon: Swords },
      { href: '/quests', label: 'Quests', icon: ListChecks },
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/jobs/verification', label: 'Source verification', icon: BadgeCheck },
      { href: '/applications', label: 'Applications', icon: Target },
      { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
      { href: '/inbox', label: 'Inbox', icon: Inbox },
      { href: '/outreach', label: 'Outreach', icon: Send },
      { href: '/brief', label: 'Market brief', icon: Newspaper },
      { href: '/daily-brief', label: 'Daily brief', icon: Sun },
      { href: '/market/skill-demand', label: 'Skill demand', icon: BarChart3 },
      { href: '/market/trends', label: 'Trends', icon: TrendingUp },
      { href: '/evidence', label: 'Evidence', icon: Activity },
      { href: '/repository-analysis', label: 'Repositories', icon: FolderGit2 },
      { href: '/facts', label: 'Fact base', icon: FileCheck },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings', label: 'Overview', icon: Settings },
      { href: '/settings/usage', label: 'Usage & costs', icon: Receipt },
      { href: '/settings/providers', label: 'AI providers', icon: Sparkles },
      { href: '/settings/embeddings', label: 'Embeddings', icon: Cpu },
      { href: '/settings/search-providers', label: 'Search providers', icon: Search },
      { href: '/settings/job-sources', label: 'Job sources', icon: Rss },
      { href: '/settings/integrations', label: 'Integrations', icon: Activity },
      { href: '/settings/devices', label: 'Devices', icon: MonitorSmartphone },
      { href: '/settings/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings/backup', label: 'Backup & storage', icon: DatabaseBackup },
      { href: '/settings/security', label: 'Security', icon: KeyRound },
      { href: '/settings/data', label: 'Data & privacy', icon: Lock },
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
