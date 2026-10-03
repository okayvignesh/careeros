'use client';

import { useCallback, useState, type FormEvent } from 'react';
import {
  Activity,
  CheckCircle2,
  Gitlab,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input, cn } from '@careeros/ui';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import {
  GITLAB_MIN_PAT_LENGTH,
  buildGitlabConnectPayload,
  connectBlockedReason,
  gitlabBaseUrlFromRow,
  gitlabHostFromRow,
  hostFromUrl,
  isSelfHostedHost,
  needsAllowlistOptIn,
  type GitlabConnectFormState,
} from './gitlab-connect';

interface IntegrationRow {
  kind: string;
  status: string;
  connectedAt: string;
  metadata: Record<string, unknown> | null;
}

interface GitlabProbeResult {
  ok: boolean;
  status: number;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
}

export function IntegrationsPanel() {
  const refresh = useCallback(() => apiGet<IntegrationRow[]>('/integrations'), []);
  const { data: rows, error, refetch } = useApi<IntegrationRow[]>(refresh);

  const github = rows?.find((r) => r.kind === 'github') ?? null;
  const gitlab = rows?.find((r) => r.kind === 'gitlab') ?? null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}
      {rows === null ? (
        <Skeleton />
      ) : (
        <>
          <GithubCard row={github} onChanged={refetch} />
          <GitlabCard row={gitlab} onChanged={refetch} />
        </>
      )}
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

/**
 * GitLab connect card. Backed by `POST /integrations/gitlab/connect`
 * (`{ pat, baseUrl?, allowlistOptIn? }`), `DELETE /integrations/gitlab`,
 * `POST /integrations/gitlab/resync` and `GET /integrations/gitlab/probe`.
 * Self-hosted hosts require the explicit allowlist opt-in before submit.
 */
export function GitlabCard({
  row,
  onChanged,
}: {
  row: IntegrationRow | null;
  onChanged: () => Promise<void>;
}) {
  const connected = row?.status === 'connected';
  const host = gitlabHostFromRow(row);
  const [showForm, setShowForm] = useState(!connected);
  const [form, setForm] = useState<GitlabConnectFormState>({
    pat: '',
    baseUrl: '',
    allowlistOptIn: false,
  });
  const [busy, setBusy] = useState<'connect' | 'resync' | 'probe' | 'disconnect' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [probe, setProbe] = useState<GitlabProbeResult | null>(null);

  function patchForm(next: Partial<GitlabConnectFormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    if (connectBlockedReason(form) !== null) return;
    setBusy('connect');
    setFailed(null);
    setNote(null);
    setProbe(null);
    try {
      await apiPost('/integrations/gitlab/connect', buildGitlabConnectPayload(form));
      setForm({ pat: '', baseUrl: '', allowlistOptIn: false });
      setShowForm(false);
      setNote('GitLab connected. Sync will run shortly.');
      await onChanged();
    } catch (e) {
      // API `{ message }` errors (invalid PAT / disallowed scope / SSRF
      // base-url reject) surface verbatim.
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
      await apiPost('/integrations/gitlab/resync');
      setNote('Resync queued. Progress shows on System & workers.');
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onProbe() {
    setBusy('probe');
    setFailed(null);
    setNote(null);
    setProbe(null);
    try {
      setProbe(await apiGet<GitlabProbeResult>('/integrations/gitlab/probe'));
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function onToggleReauth() {
    const next = !showForm;
    if (next && connected) {
      // Prefill the host on reauth so rotating a PAT never silently falls back
      // to gitlab.com for a self-hosted integration.
      const existing = gitlabBaseUrlFromRow(row);
      if (isSelfHostedHost(hostFromUrl(existing))) {
        setForm((prev) => ({ ...prev, baseUrl: existing ?? '' }));
      }
    }
    setShowForm(next);
  }

  async function onDisconnect() {
    if (!confirm('Disconnect GitLab? Career OS will stop syncing until you reconnect.')) return;
    setBusy('disconnect');
    setFailed(null);
    setNote(null);
    setProbe(null);
    try {
      await apiDelete('/integrations/gitlab');
      setNote('GitLab disconnected.');
      setShowForm(true);
      await onChanged();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      data-testid="gitlab-card"
      className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <Gitlab className="h-4 w-4 text-fg-muted" /> GitLab
          </div>
          <GitlabStatus row={row} host={host} />
        </div>
        {connected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              data-testid="gitlab-probe"
              onClick={onProbe}
              disabled={busy !== null}
            >
              {busy === 'probe' ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Probing
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4" /> Probe
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="gitlab-resync"
              onClick={onResync}
              disabled={busy !== null}
            >
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
            <Button variant="ghost" size="sm" onClick={onToggleReauth}>
              <KeyRound className="h-4 w-4" /> Reauth
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="gitlab-disconnect"
              onClick={onDisconnect}
              disabled={busy !== null}
            >
              {busy === 'disconnect' ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Disconnecting
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Disconnect
                </>
              )}
            </Button>
          </div>
        )}
      </header>

      {showForm && (
        <GitlabConnectForm
          form={form}
          connected={connected}
          busy={busy !== null}
          onPat={(pat) => patchForm({ pat })}
          onBaseUrl={(baseUrl) => patchForm({ baseUrl })}
          onAllowlist={(allowlistOptIn) => patchForm({ allowlistOptIn })}
          onSubmit={onConnect}
        />
      )}

      {probe && <GitlabProbeRow probe={probe} />}

      {note && (
        <div
          role="status"
          className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success"
        >
          {note}
        </div>
      )}
      {failed && (
        <div
          role="alert"
          data-testid="gitlab-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {failed}
        </div>
      )}
    </section>
  );
}

/**
 * Presentational connect form (exported for render tests). Mirrors the API's
 * validation so the submit button is disabled until the form can pass:
 * PAT length ≥ 20 and, for a non-gitlab.com host, the allowlist opt-in ticked.
 */
export function GitlabConnectForm({
  form,
  connected,
  busy,
  onPat,
  onBaseUrl,
  onAllowlist,
  onSubmit,
}: {
  form: GitlabConnectFormState;
  connected: boolean;
  busy: boolean;
  onPat: (value: string) => void;
  onBaseUrl: (value: string) => void;
  onAllowlist: (value: boolean) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const blocked = connectBlockedReason(form);
  const selfHosted = needsAllowlistOptIn(form.baseUrl);
  const host = hostFromUrl(form.baseUrl);

  return (
    <form
      onSubmit={onSubmit}
      data-testid="gitlab-connect-form"
      className="flex flex-col gap-3"
      aria-label="Connect GitLab"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gitlab-pat" className="text-[12px] font-medium text-fg-subtle">
          {connected
            ? 'Rotate personal access token'
            : 'Personal access token (scopes: read_api, read_user)'}
        </label>
        <Input
          id="gitlab-pat"
          data-testid="gitlab-pat"
          type="password"
          value={form.pat}
          onChange={(e) => onPat(e.target.value)}
          placeholder="glpat-…"
          autoComplete="off"
          minLength={GITLAB_MIN_PAT_LENGTH}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gitlab-base-url" className="text-[12px] font-medium text-fg-subtle">
          Self-hosted base URL (optional — leave blank for gitlab.com)
        </label>
        <Input
          id="gitlab-base-url"
          data-testid="gitlab-base-url"
          type="url"
          value={form.baseUrl}
          onChange={(e) => onBaseUrl(e.target.value)}
          placeholder="https://gitlab.example.com"
          inputMode="url"
        />
      </div>

      {selfHosted && (
        <div
          data-testid="gitlab-allowlist-block"
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-warn/30 bg-warn/10 px-3.5 py-3"
        >
          <div className="flex items-start gap-2.5">
            <input
              id="gitlab-allowlist"
              data-testid="gitlab-allowlist"
              type="checkbox"
              checked={form.allowlistOptIn}
              onChange={(e) => onAllowlist(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <label htmlFor="gitlab-allowlist" className="text-[12.5px] leading-relaxed text-fg">
              I confirm <span className="font-mono">{host ?? 'this host'}</span> is my own GitLab
              host and I want Career OS to send my token there.
            </label>
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-muted">
            Self-hosted hosts are not on the safe-host allowlist by default. Without this opt-in the
            API rejects the connection (SSRF guard). Only <span className="font-mono">{host ?? 'your host'}</span>{' '}
            is contacted, over TLS.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          data-testid="gitlab-connect"
          disabled={busy || blocked !== null}
          aria-describedby={blocked !== null ? 'gitlab-connect-hint' : undefined}
        >
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving
            </>
          ) : connected ? (
            'Save token'
          ) : (
            'Connect GitLab'
          )}
        </Button>
        {blocked && (
          <span
            id="gitlab-connect-hint"
            data-testid="gitlab-connect-hint"
            className="text-[11.5px] text-fg-faint"
          >
            {blocked}
          </span>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-fg-faint">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Encrypted at rest with AES-GCM. Use least-privilege read_api + read_user scopes. The token
        is only sent to your configured host over TLS.
      </p>
    </form>
  );
}

function GitlabStatus({ row, host }: { row: IntegrationRow | null; host: string | null }) {
  if (!row) {
    return (
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <XCircle className="h-3.5 w-3.5 text-fg-faint" /> Not connected
      </div>
    );
  }
  const connected = row.status === 'connected';
  const username = (row.metadata as { username?: string } | null)?.username;
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
      <span className="font-mono text-fg-faint">
        {host ?? 'gitlab.com'}
        {host && isSelfHostedHost(host) ? ' (self-hosted)' : ''}
      </span>
      {username && <span className="font-mono">@{username}</span>}
      <span className="font-mono text-fg-faint">
        since {new Date(row.connectedAt).toLocaleDateString()}
      </span>
    </div>
  );
}

function GitlabProbeRow({ probe }: { probe: GitlabProbeResult }) {
  const reachable = probe.ok;
  return (
    <div
      role="status"
      data-testid="gitlab-probe-result"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-[12.5px]',
        reachable
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {reachable ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        {reachable ? 'Reachable' : 'Unreachable'}
      </span>
      <span className="font-mono text-fg-muted">HTTP {probe.status}</span>
      {probe.rateLimitRemaining !== null && (
        <span className="font-mono text-fg-faint">
          {probe.rateLimitRemaining} requests left
        </span>
      )}
    </div>
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
