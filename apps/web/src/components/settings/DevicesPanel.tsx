'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Laptop, MonitorSmartphone, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, cn } from '@careeros/ui';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import {
  type AgentDevice,
  type PairingCode,
  devicePlatformLabel,
  deviceStatus,
  listAgentDevices,
  relativeTime,
  revokeAgentDevice,
  startAgentPairing,
} from '@/lib/agent';

/**
 * D.3: list + revoke paired desktop-agent devices and mint a pairing code.
 * Backed by `/agent/*` (session-cookie auth). `pair/start` needs a session
 * younger than 5 min, so a 403 surfaces the re-auth message verbatim.
 */
export function DevicesPanel() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => listAgentDevices(), []);
  const { data: devices, error, refetch } = useApi<AgentDevice[]>(refresh);

  // Keep "last seen" labels current without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  async function onAddDevice() {
    setPairBusy(true);
    setActionError(null);
    try {
      setPairing(await startAgentPairing());
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPairBusy(false);
    }
  }

  async function onConfirmRevoke(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await revokeAgentDevice(id);
      setConfirmingId(null);
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-5" data-testid="devices-panel" aria-label="Paired devices">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-medium text-fg">Paired devices</h2>
          <p className="text-[12.5px] text-fg-muted">
            Each device holds its own agent credentials in the OS keychain. Revoke to disconnect it.
          </p>
        </div>
        <Button data-testid="device-add" onClick={onAddDevice} disabled={pairBusy}>
          {pairBusy ? (
            <>
              <ThinkingOrb state="connecting" size={20} /> Generating
            </>
          ) : (
            <>
              <MonitorSmartphone className="h-4 w-4" /> Add device
            </>
          )}
        </Button>
      </header>

      {actionError && (
        <div
          role="alert"
          data-testid="devices-action-error"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {actionError}
        </div>
      )}

      {pairing && <PairingCodeCard pairing={pairing} onDismiss={() => setPairing(null)} />}

      {error ? (
        <UnavailableNotice feature="Paired devices" testId="devices-unavailable" />
      ) : devices === null ? (
        <Loader size={64} label="Loading paired devices" />
      ) : devices.length === 0 ? (
        <p
          data-testid="devices-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          No devices paired yet. Download the agent, then click Add device for a pairing code.
        </p>
      ) : (
        <DeviceList
          devices={devices}
          now={now}
          busyId={busyId}
          confirmingId={confirmingId}
          onAskRevoke={setConfirmingId}
          onCancelRevoke={() => setConfirmingId(null)}
          onConfirmRevoke={onConfirmRevoke}
        />
      )}
    </section>
  );
}

export interface DeviceListProps {
  devices: AgentDevice[];
  now: number;
  busyId: string | null;
  confirmingId: string | null;
  onAskRevoke: (id: string) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (id: string) => void;
}

export function DeviceList({
  devices,
  now,
  busyId,
  confirmingId,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: DeviceListProps) {
  return (
    <ul className="flex flex-col gap-3" data-testid="device-list">
      {devices.map((device) => {
        const status = deviceStatus(device);
        return (
          <li
            key={device.id}
            data-testid="device-row"
            className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Laptop className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
                  <span className="text-[15px] font-medium text-fg">{device.name}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em]',
                      status.revoked
                        ? 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-faint'
                        : 'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
                    )}
                  >
                    {status.revoked ? (
                      <XCircle className="h-3 w-3" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {status.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted">
                  <span>{devicePlatformLabel(device.platform)}</span>
                  {device.agentVersion && (
                    <span className="font-mono text-fg-subtle">{device.agentVersion}</span>
                  )}
                  <span>Last seen {relativeTime(device.lastSeenAt, now)}</span>
                  <span>Paired {relativeTime(device.pairedAt, now)}</span>
                </div>
              </div>

              {!status.revoked &&
                (confirmingId === device.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-fg-muted">Revoke this device?</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="device-revoke-cancel"
                      onClick={onCancelRevoke}
                      disabled={busyId === device.id}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid="device-revoke-confirm"
                      onClick={() => onConfirmRevoke(device.id)}
                      disabled={busyId === device.id}
                    >
                      {busyId === device.id ? (
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
                    data-testid="device-revoke"
                    onClick={() => onAskRevoke(device.id)}
                  >
                    <Trash2 className="h-4 w-4" /> Revoke
                  </Button>
                ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PairingCodeCard({ pairing, onDismiss }: { pairing: PairingCode; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-testid="pairing-card"
      className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius)] border border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.06)] px-5 py-4"
    >
      <div className="flex flex-col gap-1" role="status" aria-live="polite">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-subtle">
          <ShieldCheck className="h-3.5 w-3.5" /> Pairing code — enter it in the agent
        </span>
        <span data-testid="pairing-code" className="font-mono text-[28px] tracking-[0.3em] text-fg">
          {pairing.code}
        </span>
        <span className="text-[11.5px] text-fg-faint">
          Expires at {new Date(pairing.expiresAt).toLocaleTimeString()} · single use
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-testid="pairing-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(pairing.code).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" size="sm" data-testid="pairing-dismiss" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}
