'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input, cn } from '@careeros/ui';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface IntegrationRow {
  kind: string;
  status: string;
  connectedAt: string;
  metadata: Record<string, unknown> | null;
}

export function IntegrationsPanel() {
  const refresh = useCallback(() => apiGet<IntegrationRow[]>('/integrations'), []);
  const { data: rows, error, refetch } = useApi<IntegrationRow[]>(refresh);

  const github = rows?.find((r) => r.kind === 'github') ?? null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}
      {rows === null ? <Skeleton /> : <GithubCard row={github} onChanged={refetch} />}
      <PendingRow label="Slack" scheduled="P5" />
      <PendingRow label="Gmail" scheduled="P5" />
    </div>
  );
}

function GithubCard({
  row,
  onChanged,
}: {
  row: IntegrationRow | null;
  onChanged: () => Promise<void>;
}) {
  const connected = row?.status === 'connected';
  const [showToken, setShowToken] = useState(!connected);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'save' | 'resync' | 'revoke' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setFailed(null);
    setNote(null);
    try {
      await apiPost('/integrations/github', { token });
      setToken('');
      setShowToken(false);
      setNote('GitHub token saved. Repo sync will run shortly.');
      await onChanged();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onResync() {
    setBusy('resync');
    setFailed(null);
    setNote(null);
    try {
      await apiPost('/integrations/github/resync');
      setNote('Resync queued. Progress shows on System & workers.');
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onRevoke() {
    if (!confirm('Revoke GitHub access? Career OS will stop syncing repos until you reconnect.'))
      return;
    setBusy('revoke');
    setFailed(null);
    setNote(null);
    try {
      await apiDelete('/integrations/github');
      setNote('GitHub disconnected.');
      setShowToken(true);
      await onChanged();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[15px] font-medium text-fg">GitHub</div>
          <StatusRow row={row} />
        </div>
        {connected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onResync} disabled={busy !== null}>
              {busy === 'resync' ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Queuing
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Resync
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowToken((s) => !s)}>
              <KeyRound className="h-4 w-4" /> Reauth
            </Button>
            <Button variant="ghost" size="sm" onClick={onRevoke} disabled={busy !== null}>
              {busy === 'revoke' ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Revoking
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Revoke
                </>
              )}
            </Button>
          </div>
        )}
      </header>

      {showToken && (
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <label className="text-[12px] font-medium text-fg-subtle">
            {connected ? 'Rotate token' : 'Personal-access token (scopes: repo, read:user)'}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_…"
              required
              className="flex-1"
            />
            <Button type="submit" disabled={busy !== null}>
              {busy === 'save' ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Saving
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-faint">
            Encrypted at rest with AES-GCM. Only sent to github.com over TLS.
          </p>
        </form>
      )}

      {note && (
        <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success">
          {note}
        </div>
      )}
      {failed && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {failed}
        </div>
      )}
    </section>
  );
}

function StatusRow({ row }: { row: IntegrationRow | null }) {
  if (!row) {
    return (
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <XCircle className="h-3.5 w-3.5 text-fg-faint" /> Not connected
      </div>
    );
  }
  const connected = row.status === 'connected';
  const login = (row.metadata as { login?: string } | null)?.login;
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-fg-muted">
      <span
        className={cn(
          'flex items-center gap-1.5',
          connected ? 'text-success' : 'text-fg-faint',
        )}
      >
        {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        {row.status}
      </span>
      {login && <span className="font-mono">@{login}</span>}
      <span className="font-mono text-fg-faint">
        since {new Date(row.connectedAt).toLocaleDateString()}
      </span>
    </div>
  );
}

function PendingRow({ label, scheduled }: { label: string; scheduled: string }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
      <span className="text-[14px] font-medium text-fg-subtle">{label}</span>
      <span className="text-[12px] text-fg-faint">Lands in {scheduled}</span>
    </div>
  );
}

function Skeleton() {
  return <div className="h-28 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />;
}
