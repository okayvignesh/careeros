'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Github, Gitlab, Mail, MessageSquare } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { Dialog } from '@/components/Dialog';
import { GitlabCard } from '@/components/settings/IntegrationsPanel';
import {
  beginOAuth,
  type IntegrationRow,
  type OAuthKind,
} from '@/components/settings/oauth-integrations';

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

const OAUTH_KINDS = new Set<Integration['kind']>(['slack', 'gmail']);

export function IntegrationsList() {
  const router = useRouter();
  const [items, setItems] = useState<Integration[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gitlabOpen, setGitlabOpen] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<Integration['kind'] | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Integration[]>('/integrations')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setReady(true));
  }, []);

  async function refetch() {
    try {
      setItems(await apiGet<Integration[]>('/integrations'));
    } catch {
      setItems([]);
    }
  }

  const status = (kind: Integration['kind']) =>
    items.find((i) => i.kind === kind && i.status === 'connected');

  const gitlabRow = (items.find((i) => i.kind === 'gitlab') ?? null) as IntegrationRow | null;

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

  async function connectOAuth(kind: OAuthKind) {
    setOauthBusy(kind);
    setOauthError(null);
    try {
      // The integration cards live under /settings, which the setup gate
      // redirects back into the wizard. Start OAuth directly from here instead.
      await beginOAuth(kind, {
        loadUrl: (path) => apiGet<{ url: string }>(path),
        navigate: (url) => {
          window.open(url, '_blank', 'noopener,noreferrer');
        },
      });
    } catch (e) {
      setOauthError(`${kind === 'slack' ? 'Slack' : 'Gmail'}: ${(e as Error).message}`);
    } finally {
      setOauthBusy(null);
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
              ) : kind === 'gitlab' ? (
                <button
                  type="button"
                  data-testid="setup-gitlab-connect"
                  onClick={() => setGitlabOpen(true)}
                  className="text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Connect →
                </button>
              ) : OAUTH_KINDS.has(kind) ? (
                <button
                  type="button"
                  data-testid={`setup-${kind}-connect`}
                  disabled={oauthBusy === kind}
                  onClick={() => void connectOAuth(kind as OAuthKind)}
                  className="text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                >
                  {oauthBusy === kind ? 'Opening…' : 'Connect →'}
                </button>
              ) : (
                <Link
                  href="/setup/07-github"
                  className="text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Connect →
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>

      {oauthError ? (
        <p role="alert" className="text-[12.5px] text-[hsl(var(--danger))]">
          {oauthError} — set the provider&apos;s client ID/secret in the server environment, then retry.
        </p>
      ) : null}

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

      <Dialog
        open={gitlabOpen}
        onClose={() => setGitlabOpen(false)}
        title="Connect GitLab"
        description="Use a personal access token with read_api scope. Works with gitlab.com and self-hosted instances."
        testId="setup-gitlab-dialog"
      >
        <GitlabCard
          row={gitlabRow}
          onChanged={async () => {
            await refetch();
            setGitlabOpen(false);
          }}
        />
      </Dialog>
    </div>
  );
}
