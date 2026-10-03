import Link from 'next/link';
import { Activity, ArrowUpRight, Boxes, Briefcase, Cpu, MonitorSmartphone, Receipt, Sparkles } from 'lucide-react';
import { Eyebrow } from '@careeros/ui';

const cards = [
  {
    href: '/settings/usage',
    icon: Receipt,
    title: 'Usage & costs',
    body: 'Token spend, per-model breakdown, monthly budget, and the kill switch for LLM calls.',
  },
  {
    href: '/settings/providers',
    icon: Sparkles,
    title: 'AI providers',
    body: 'Switch, add, and probe LLM providers. Encrypted keys, per-provider sensitivity ceilings.',
  },
  {
    href: '/settings/embeddings',
    icon: Cpu,
    title: 'Embeddings',
    body: 'Switch between local bge-small and an external embedding endpoint. Re-embed your corpus.',
  },
  {
    href: '/settings/integrations',
    icon: Activity,
    title: 'Integrations',
    body: 'GitHub today; Slack and Gmail in P5. Reauthorise or revoke access.',
  },
  {
    href: '/settings/devices',
    icon: MonitorSmartphone,
    title: 'Devices',
    body: 'Download the desktop agent, pair a machine, see last-seen status, and revoke access.',
  },
  {
    href: '/settings/workers',
    icon: Boxes,
    title: 'System & workers',
    body: 'BullMQ queue depths, failed jobs, retry, and per-queue health.',
  },
  {
    href: '/settings/job-preferences',
    icon: Briefcase,
    title: 'Job preferences',
    body: 'Target roles, remote-only, comp range, must-have skills, dealbreakers. Drives the /jobs relevance filter.',
  },
];

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-10 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Configure Career OS
        </h1>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4 transition-colors duration-[var(--dur-fast)] hover:border-[hsl(var(--border-active))]"
          >
            <div className="flex items-center justify-between">
              <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
              <ArrowUpRight className="h-4 w-4 text-fg-faint transition-colors group-hover:text-fg" strokeWidth={1.7} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[15px] font-medium text-fg">{title}</div>
              <div className="text-[12.5px] leading-relaxed text-fg-muted">{body}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
