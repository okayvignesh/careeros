import { z } from 'zod';

/**
 * Zod schemas for the desktop agent contract. Server validates outbound tasks
 * with these before pushing to the WSS room; the agent re-validates on
 * receipt (belt-and-braces since messages cross a trust boundary).
 *
 * Kept intentionally small: only fields the agent actually needs at runtime.
 * Persistence-only columns (created_by, retry counters, etc.) live on the
 * server Prisma schema, not here.
 */

export const AGENT_TASK_KINDS = [
  'linkedin-discover',
  'indeed-discover',
  'ashby-apply',
  'greenhouse-apply',
  'lever-apply',
  'workday-apply',
  'linkedin-easy-apply',
  'indeed-easy-apply',
  'naukri-apply',
  'generic-apply',
] as const;

export const AgentTaskKind = z.enum(AGENT_TASK_KINDS);
export type AgentTaskKind = z.infer<typeof AgentTaskKind>;

/**
 * `params` is validated per-kind by the individual script modules (they own
 * their input contract). Here we only assert it's a JSON object so the
 * envelope round-trips through JSON safely.
 */
export const AgentTask = z.object({
  id: z.string().uuid(),
  kind: AgentTaskKind,
  params: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const AgentResultStatus = z.enum(['ok', 'error', 'timeout', 'blocked']);
export type AgentResultStatus = z.infer<typeof AgentResultStatus>;

export const EvidenceBundle = z.object({
  screenshotShas: z.array(z.string().regex(/^[a-f0-9]{64}$/i)),
  harShas: z.array(z.string().regex(/^[a-f0-9]{64}$/i)),
  domSnapshotSha: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  urlsVisited: z.array(z.string().url()),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

export const AgentResult = z.object({
  taskId: z.string().uuid(),
  status: AgentResultStatus,
  evidence: EvidenceBundle.optional(),
  error: z.string().optional(),
  completedAt: z.string().datetime(),
});
export type AgentResult = z.infer<typeof AgentResult>;

/** Device pairing (device-code flow, phase-3.5 §Server side). */
export const DeviceInfo = z.object({
  name: z.string().min(1).max(120),
  os: z.enum(['macos', 'windows', 'linux']),
  agentVersion: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const PairingRequest = z.object({
  code: z.string().length(8),
  device: DeviceInfo,
});
export type PairingRequest = z.infer<typeof PairingRequest>;

export const PairingComplete = z.object({
  agentId: z.string().uuid(),
  jwt: z.string().min(1),
  refreshToken: z.string().min(1),
  wssUrl: z.string().url(),
});
export type PairingComplete = z.infer<typeof PairingComplete>;
