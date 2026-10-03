import { apiDelete, apiGet, apiPost } from './api-client';

/**
 * Typed client for the D.2 desktop-agent endpoints. Kept in one module so the
 * Devices page has no inline path strings and the response shapes match
 * `AgentService.listDevices` / `pairStart`.
 */

/** One row from `GET /agent/devices` (see `AgentService.listDevices`). */
export interface AgentDevice {
  id: string;
  name: string;
  platform: string | null;
  pairedAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
}

/** Response of `POST /agent/pair/start`. */
export interface PairingCode {
  code: string;
  pairingRequestId: string;
  expiresAt: string;
}

export function listAgentDevices(): Promise<AgentDevice[]> {
  return apiGet<AgentDevice[]>('/agent/devices');
}

/** `DELETE /agent/devices/:id` — soft-revoke; drops every agent session. */
export function revokeAgentDevice(id: string): Promise<void> {
  return apiDelete<void>(`/agent/devices/${id}`);
}

/** `POST /agent/pair/start` — requires a <5 min fresh session. */
export function startAgentPairing(): Promise<PairingCode> {
  return apiPost<PairingCode>('/agent/pair/start');
}

/** Direct download hub for the signed installer artifacts (desktop-v* tags). */
export const DESKTOP_RELEASES_URL = 'https://github.com/okayvignesh/careeros/releases';

/** Map Node's `process.platform` to a human label; unknown/null → "Unknown". */
export function devicePlatformLabel(platform: string | null | undefined): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'Unknown';
  }
}

export interface AgentDeviceStatus {
  label: 'Active' | 'Revoked';
  revoked: boolean;
}

export function deviceStatus(device: Pick<AgentDevice, 'revokedAt'>): AgentDeviceStatus {
  return device.revokedAt
    ? { label: 'Revoked', revoked: true }
    : { label: 'Active', revoked: false };
}

/**
 * Compact relative time. `now` is injected so tests are deterministic — the
 * page never formats timestamps on the server (AGENTS.md timezone rule).
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'Unknown';
  const delta = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return 'Just now';
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  return `${Math.floor(delta / day)}d ago`;
}
