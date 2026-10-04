'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  Blocks,
  Briefcase,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
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
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/daily-brief', label: 'Daily brief', icon: Sun },
      { href: '/inbox', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    label: 'Hunt',
    items: [
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/applications', label: 'Applications', icon: Target },
      { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
      { href: '/outreach', label: 'Outreach', icon: Send },
    ],
  },
  {
    label: 'Market',
    items: [
      { href: '/brief', label: 'Market brief', icon: Newspaper },
      { href: '/market/skill-demand', label: 'Skill demand', icon: BarChart3 },
      { href: '/market/trends', label: 'Trends', icon: TrendingUp },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/skills', label: 'Skills', icon: Wrench },
      { href: '/arena', label: 'Arena', icon: Swords },
      { href: '/quests', label: 'Quests', icon: ListChecks },
    ],
  },
  {
    label: 'Evidence',
    items: [
      { href: '/evidence', label: 'Evidence', icon: Activity },
      { href: '/facts', label: 'Fact base', icon: FileCheck },
      { href: '/repository-analysis', label: 'Repositories', icon: FolderGit2 },
      { href: '/jobs/verification', label: 'Source verification', icon: BadgeCheck },
    ],
  },
  {
    label: 'Connections',
    items: [
      { href: '/settings/integrations', label: 'Integrations', icon: Blocks },
      { href: '/settings/providers', label: 'AI providers', icon: Sparkles },
      { href: '/settings/embeddings', label: 'Embeddings', icon: Cpu },
      { href: '/settings/search-providers', label: 'Search providers', icon: Search },
      { href: '/settings/job-sources', label: 'Job sources', icon: Rss },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings', label: 'Overview', icon: Settings },
      { href: '/settings/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings/security', label: 'Security', icon: KeyRound },
      { href: '/settings/data', label: 'Data & privacy', icon: Lock },
      { href: '/settings/devices', label: 'Devices', icon: MonitorSmartphone },
      { href: '/settings/usage', label: 'Usage & costs', icon: Receipt },
      { href: '/settings/backup', label: 'Backup & storage', icon: DatabaseBackup },
      { href: '/settings/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

export function AppNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  function toggle(label: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <nav className="flex flex-1 flex-col gap-4 text-[13px]">
      <div className="flex items-center justify-end gap-1 px-1">
        <button
          type="button"
          onClick={() => setCollapsed(new Set(groups.map((g) => g.label)))}
          aria-label="Collapse all sections"
          title="Collapse all"
          data-testid="nav-collapse-all"
          className="rounded-md p-1 text-fg-faint transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
        >
          <ChevronsDownUp className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          aria-label="Expand all sections"
          title="Expand all"
          data-testid="nav-expand-all"
          className="rounded-md p-1 text-fg-faint transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.label);
        return (
          <div key={g.label} className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => toggle(g.label)}
              aria-expanded={!isCollapsed}
              data-testid={`nav-group-${g.label.toLowerCase()}`}
              className="group flex items-center justify-between gap-2 px-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-faint transition-colors hover:text-fg-muted"
            >
              <span>{g.label}</span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-[var(--dur-fast)]',
                  isCollapsed ? '-rotate-90' : 'rotate-0',
                )}
                strokeWidth={2}
                aria-hidden
              />
            </button>
            {!isCollapsed && (
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
