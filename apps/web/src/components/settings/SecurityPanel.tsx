'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Fingerprint,
  KeyRound,
  MonitorSmartphone,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { Dialog } from '@/components/Dialog';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import {
  type PasskeyCredential,
  listPasskeys,
  registerPasskey,
  removePasskey,
} from '@/lib/passkey';
import {
  type ActiveSession,
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from '@/lib/sessions';

/**
 * Security settings. Passkeys (C-P0.7) and — added with A-H3 session
 * management — the devices currently signed in to this account.
 */
export function SecurityPanel() {
  return (
    <div className="flex flex-col gap-10" data-testid="security-panel">
      <PasskeysSection />
      <SessionsSection />
    </div>
  );
}

/**
 * C-P0.7 passkey management: register a WebAuthn credential, list the ones on
 * the account, and revoke one. All three call the real `/auth/passkey/*`
 * endpoints; the browser ceremony runs against the platform WebAuthn API
 * (see `lib/passkey.ts`).
 */
export function PasskeysSection() {
  const load = useCallback(() => listPasskeys(), []);
  const { data: passkeys, error, refetch } = useApi<PasskeyCredential[]>(load);

  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setRegistering(true);
    setActionError(null);
    try {
      await registerPasskey(name);
      setName('');
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRegistering(false);
    }
  }

  async function onRemove(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await removePasskey(id);
      setConfirmingId(null);
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-5" data-testid="passkeys-section" aria-label="Passkeys">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          <Fingerprint className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Passkeys
        </h2>
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
          Sign in without a password using the secure enclave on this device. Register at least
          two so losing one device does not lock you out.
        </p>
      </header>

      {actionError && (
        <div
          role="alert"
          data-testid="passkey-action-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {actionError}
        </div>
      )}

      <form onSubmit={onRegister} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <span className="text-[12px] font-medium text-fg-subtle">Passkey name</span>
          <Input
            data-testid="passkey-name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MacBook Pro Touch ID"
          />
        </label>
        <Button type="submit" data-testid="passkey-register" disabled={registering}>
          {registering ? (
            <>
              <ThinkingOrb state="connecting" size={20} /> Waiting for device
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Register passkey
            </>
          )}
        </Button>
      </form>

      {error ? (
        <UnavailableNotice feature="Passkeys" testId="passkeys-unavailable" />
      ) : passkeys === null ? (
        <Loader size={64} label="Loading passkeys" />
      ) : passkeys.length === 0 ? (
        <p
          data-testid="passkeys-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          No passkeys yet. Register one to enable passwordless sign-in.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="passkey-list">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              data-testid="passkey-row"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
                  <span className="text-[14px] font-medium text-fg">
                    {passkey.name ?? 'Unnamed passkey'}
                  </span>
                </div>
                <span className="text-[12px] text-fg-muted">
                  Added {new Date(passkey.createdAt).toLocaleDateString()} ·{' '}
                  {passkey.lastUsedAt
                    ? `last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                    : 'never used'}
                  {passkey.transports.length > 0 && ` · ${passkey.transports.join(', ')}`}
                </span>
              </div>

              {confirmingId === passkey.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-fg-muted">Revoke this passkey?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="passkey-revoke-cancel"
                    onClick={() => setConfirmingId(null)}
                    disabled={busyId === passkey.id}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    data-testid="passkey-revoke-confirm"
                    onClick={() => onRemove(passkey.id)}
                    disabled={busyId === passkey.id}
                  >
                    {busyId === passkey.id ? (
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
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="passkey-revoke"
                  onClick={() => setConfirmingId(passkey.id)}
                >
                  <Trash2 className="h-4 w-4" /> Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type SessionConfirm = ActiveSession | 'others' | null;

/**
 * A-H3 active-session management. Lists the caller's own sessions (the API
 * scopes by user and masks the IP), flags the current one, and revokes a
 * single session or every other session. A decision goes through a confirm
 * dialog; the outcome is announced as a non-blocking toast.
 */
export function SessionsSection() {
  const load = useCallback(() => listSessions(), []);
  const { data: sessions, error, refetch } = useApi<ActiveSession[]>(load);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SessionConfirm>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function onRevoke(session: ActiveSession) {
    setBusyId(session.id);
    setActionError(null);
    try {
      await revokeSession(session.id);
      setToast(`Signed out ${session.label}.`);
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function onRevokeOthers() {
    setRevokingOthers(true);
    setActionError(null);
    try {
      const { revoked } = await revokeOtherSessions();
      setToast(
        revoked === 0
          ? 'No other sessions to sign out.'
          : revoked === 1
            ? 'Signed out 1 other session.'
            : `Signed out ${revoked} other sessions.`,
      );
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRevokingOthers(false);
      setConfirm(null);
    }
  }

  const target = confirm && confirm !== 'others' ? confirm : null;
  const description =
    confirm === 'others'
      ? 'Every other device is signed out immediately. This device stays signed in.'
      : target
        ? `Sign out ${target.label}? That device must sign in again.`
        : '';

  return (
    <section className="flex flex-col gap-5" data-testid="sessions-section" aria-label="Active sessions">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <MonitorSmartphone className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Active sessions
          </h2>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
            Every device signed in to this account. Revoke one you do not recognize; other devices
            sign in again, this one is unaffected.
          </p>
        </div>
        {sessions && sessions.length > 1 && (
          <Button
            variant="secondary"
            size="sm"
            data-testid="session-revoke-others"
            onClick={() => setConfirm('others')}
          >
            <Trash2 className="h-4 w-4" /> Sign out other sessions
          </Button>
        )}
      </header>

      {actionError && (
        <div
          role="alert"
          data-testid="sessions-action-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {actionError}
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sessions-toast"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success"
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {toast}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="sessions-toast-dismiss"
            onClick={() => setToast(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {error ? (
        <UnavailableNotice feature="Active sessions" testId="sessions-unavailable" />
      ) : sessions === null ? (
        <Loader size={64} label="Loading active sessions" />
      ) : sessions.length === 0 ? (
        <p
          data-testid="sessions-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          No active sessions recorded.
        </p>
      ) : (
        <SessionList sessions={sessions} busyId={busyId} onAskRevoke={setConfirm} />
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'others' ? 'Sign out other sessions' : 'Revoke session'}
        description={description}
        testId="session-revoke-dialog"
        footer={
          <>
            <Button
              variant="ghost"
              data-testid="session-revoke-cancel"
              onClick={() => setConfirm(null)}
              disabled={busyId !== null || revokingOthers}
            >
              Cancel
            </Button>
            {confirm === 'others' ? (
              <Button
                variant="danger"
                data-testid="session-revoke-others-confirm"
                onClick={onRevokeOthers}
                disabled={revokingOthers}
              >
                {revokingOthers ? (
                  <>
                    <ThinkingOrb state="working" size={20} /> Signing out
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> Sign out others
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="danger"
                data-testid="session-revoke-confirm"
                onClick={() => target && onRevoke(target)}
                disabled={busyId !== null}
              >
                {busyId !== null ? (
                  <>
                    <ThinkingOrb state="working" size={20} /> Revoking
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> Revoke
                  </>
                )}
              </Button>
            )}
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-fg-muted">
          Revoking drops the sealed cookie on that device immediately. It does not change your
          password or passkeys.
        </p>
      </Dialog>
    </section>
  );
}

export interface SessionListProps {
  sessions: ActiveSession[];
  busyId: string | null;
  onAskRevoke: (session: ActiveSession) => void;
}

/** Presentational session list — extracted so a static render test can assert
 * the current-session badge and that only non-current rows expose a revoke. */
export function SessionList({ sessions, busyId, onAskRevoke }: SessionListProps) {
  return (
    <ul className="flex flex-col gap-3" data-testid="session-list">
      {sessions.map((session) => (
        <li
          key={session.id}
          data-testid="session-row"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
              <span className="text-[14px] font-medium text-fg">{session.label}</span>
              {session.current && (
                <span
                  data-testid="session-current"
                  className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em] text-[hsl(var(--success))]"
                >
                  <ShieldCheck className="h-3 w-3" /> This device
                </span>
              )}
            </div>
            <span className="text-[12px] text-fg-muted">{sessionMeta(session)}</span>
          </div>

          {session.current ? (
            <span className="text-[12px] text-fg-faint">Current session</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              data-testid="session-revoke"
              onClick={() => onAskRevoke(session)}
              disabled={busyId === session.id}
            >
              <Trash2 className="h-4 w-4" /> Revoke
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function sessionMeta(session: ActiveSession): string {
  const created = new Date(session.createdAt).toLocaleDateString();
  const seen = new Date(session.lastSeenAt).toLocaleString();
  const ip = session.ipMasked ? ` · ${session.ipMasked}` : '';
  return `Signed in ${created} · last active ${seen}${ip}`;
}
