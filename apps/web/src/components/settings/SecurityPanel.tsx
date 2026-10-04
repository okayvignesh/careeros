'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { Fingerprint, KeyRound, Plus, Trash2 } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import {
  type PasskeyCredential,
  listPasskeys,
  registerPasskey,
  removePasskey,
} from '@/lib/passkey';

/**
 * C-P0.7 passkey management: register a WebAuthn credential, list the ones on
 * the account, and revoke one. All three call the real `/auth/passkey/*`
 * endpoints; the browser ceremony runs against the platform WebAuthn API
 * (see `lib/passkey.ts`).
 */
export function SecurityPanel() {
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
    <section className="flex flex-col gap-5" data-testid="security-panel" aria-label="Passkeys">
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
