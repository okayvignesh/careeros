'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Github, Gitlab, Mail, MessageSquare } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';

interface Integration {
  kind: 'github' | 'gitlab' | 'slack' | 'gmail';
  status: 'connected' | 'revoked';
  connectedAt: string;
  metadata?: Record<string, unknown> | null;
}

const CATALOG = [
  { kind: 'github' as const, icon: Github, name: 'GitHub', body: 'Repository + commit analysis' },
  { kind: 'gitlab' as const, icon: Gitlab, name: 'GitLab', body: 'Public or self-hosted merge-request analysis' },
  { kind: 'slack' as const, icon: MessageSquare, name: 'Slack', body: 'Daily brief + slash commands' },
  { kind: 'gmail' as const, icon: Mail, name: 'Gmail', body: 'Recruiter mail + alert parsing' },
];

export function IntegrationsList() {
  const router = useRouter();
  const [items, setItems] = useState<Integration[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<Integration[]>('/integrations')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setReady(true));
  }, []);

  const status = (kind: Integration['kind']) =>
    items.find((i) => i.kind === kind && i.status === 'connected');

  async function continueForward() {
    setBusy(true);
    try {
      await apiPost('/setup/integrations/reviewed', {});
      router.push('/setup/09-resume');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="panel flex items-center justify-center px-5 py-10">
        <ThinkingOrb state="working" size={20} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="panel divide-y divide-[hsl(var(--border))]">
        {CATALOG.map(({ kind, icon: Icon, name, body }, i) => {
          const connected = status(kind);
          return (
            <motion.div
              key={kind}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={
                    connected ? 'h-4 w-4 text-[hsl(var(--accent))]' : 'h-4 w-4 text-fg-subtle'
                  }
                  strokeWidth={1.8}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-fg">{name}</span>
                  <span className="text-[12.5px] text-fg-subtle">{body}</span>
                </div>
              </div>
              {connected ? (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[hsl(var(--success))]">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Connected
                </span>
              ) : (
                <Link
                  href={kind === 'github' ? '/setup/07-github' : '/settings/integrations'}
                  className="text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Connect →
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button size="lg" onClick={continueForward} disabled={busy}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving…
            </>
          ) : (
            <>
              Continue <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
