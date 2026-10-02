// Sensitivity primitives — C-P0.3 (see plan/ai-safety.md item 8).
//
// This module owns the POLICY-FREE half of the sensitivity gate:
//   1. classifySensitivity(): heuristic label for a chunk of untrusted content,
//      using the single `Sensitivity` taxonomy from ./sensitivity.
//   2. decideProviderEgress() / allowedProviders(): pure "may this provider see
//      data at this sensitivity?" given a caller-supplied ProviderPolicy.
//
// The authoritative policy store is apps/api's SensitivityGateService, which
// reads `app_config.llm.sensitivity_policy` and is the ONE place that decides
// what may leave the process to an external provider. Nothing here holds policy,
// defaults, or a context ceiling table (cleanup task A6).
//
// The optional audit hook lets the api pipe every classification into pino /
// audit_log without dragging a logger dependency into packages/ai.

import { rankOf, type Sensitivity } from './sensitivity';
import { SensitivityBlockedError } from './errors';

/** Ordered least-sensitive → most-sensitive; `block`/`local-only` are the two
 *  non-sensitivity kill switches a provider can be pinned to. */
export type ProviderCeiling = 'block' | 'local-only' | Sensitivity;

/** Provider name → ceiling. Supplied by the policy owner (never stored here). */
export type ProviderPolicy = Record<string, ProviderCeiling>;

const CEILING_RANK: Record<ProviderCeiling, number> = {
  block: -2,
  'local-only': -1,
  public: rankOf('public'),
  personal: rankOf('personal'),
  confidential: rankOf('confidential'),
  'employer-confidential': rankOf('employer-confidential'),
};

export function ceilingRank(ceiling: ProviderCeiling): number {
  return CEILING_RANK[ceiling];
}

/** Machine-readable egress decision. The api maps this onto its 503 messages. */
export type EgressDecision =
  | { allowed: true; ceiling: ProviderCeiling }
  | {
      allowed: false;
      ceiling: ProviderCeiling;
      /** `not-permitted` = block/local-only kill switch; `above-ceiling` = data too sensitive. */
      reason: 'not-permitted' | 'above-ceiling';
    };

/**
 * The single pure egress rule. A provider's ceiling is the most-sensitive
 * label it may see; anything above it (or pinned to block/local-only) fails.
 * Unknown providers fail closed to `block`.
 */
export function decideProviderEgress(
  providerName: string,
  sensitivity: Sensitivity,
  policy: ProviderPolicy,
): EgressDecision {
  const ceiling = policy[providerName] ?? 'block';
  if (ceiling === 'block' || ceiling === 'local-only') {
    return { allowed: false, ceiling, reason: 'not-permitted' };
  }
  if (rankOf(sensitivity) > CEILING_RANK[ceiling]) {
    return { allowed: false, ceiling, reason: 'above-ceiling' };
  }
  return { allowed: true, ceiling };
}

export function isProviderAllowed(
  providerName: string,
  sensitivity: Sensitivity,
  policy: ProviderPolicy,
): boolean {
  return decideProviderEgress(providerName, sensitivity, policy).allowed;
}

/** Every provider in `policy` that may see data at `sensitivity`. */
export function allowedProviders(
  sensitivity: Sensitivity,
  policy: ProviderPolicy,
): string[] {
  return Object.keys(policy).filter((provider) =>
    decideProviderEgress(provider, sensitivity, policy).allowed,
  );
}

/**
 * Throwing wrapper over `decideProviderEgress` for package-level consumers and
 * tests. The api keeps its own 503 mapping; this exists so the gate has a
 * single, testable failure shape (`SensitivityBlockedError`).
 */
export function assertProviderAllowed(
  providerName: string,
  sensitivity: Sensitivity,
  policy: ProviderPolicy,
): void {
  const decision = decideProviderEgress(providerName, sensitivity, policy);
  if (decision.allowed) return;
  const reason =
    decision.reason === 'not-permitted'
      ? `provider ceiling is '${decision.ceiling}'`
      : `provider ceiling is ${decision.ceiling} (rank ${ceilingRank(decision.ceiling)}); content is ${sensitivity} (rank ${rankOf(sensitivity)})`;
  throw new SensitivityBlockedError(sensitivity, providerName, reason);
}

// ---------------------------------------------------------------------------
// Classifier heuristics. Order matters: highest-severity match wins.
// ponytail: regexes only. If we need semantic classification we plug an LLM
// pass in `classifySemantic()`, not here.
// ---------------------------------------------------------------------------

// Top label (local-only by default) — anything that looks like a credential.
// Anchored to reduce false positives on "The password field..." prose.
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-~+/=]{16,}/i, // Authorization: Bearer ...
  /\b(?:sk|pk|rk|xoxp|xoxb|ghp|gho|ghu|ghs|ghr|glpat)[-_][A-Za-z0-9_\-]{16,}/, // API keys (OpenAI, Slack, GitHub, GitLab)
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT-shaped
];

// personal — PII-shaped patterns. Emails + phones + national IDs.
const PRIVATE_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // NA-format phone
  /\+\d{1,3}\s?\d{4,14}\b/, // E.164-ish
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
];

/** Some ingest sources have a static sensitivity floor regardless of content.
 *  These are hints for classifySensitivity(meta.source) — the content scan
 *  still runs and wins if it detects something higher. */
const SOURCE_HINTS: Record<string, Sensitivity> = {
  // Employer-confidential surfaces.
  'private-repo': 'employer-confidential',
  'employer-code': 'employer-confidential',
  'internal-doc': 'employer-confidential',
  'company-code': 'employer-confidential',
  // Personal surfaces.
  resume: 'personal',
  email: 'personal',
  'user-input': 'personal',
  comment: 'personal',
  // Public surfaces (explicit for documentation; falls through anyway).
  'public-repo': 'public',
  'job-description': 'public',
  readme: 'public',
  'company-page': 'public',
};

// ---------------------------------------------------------------------------
// Audit hook — every classification surfaces here so the api can persist to
// audit_log / pino without packages/ai learning about them.
// ---------------------------------------------------------------------------

export interface SensitivityAuditEvent {
  code: 'security.audit.sensitivity_classified';
  level: Sensitivity;
  source?: string | undefined;
}

type SensitivityAuditHook = (event: SensitivityAuditEvent) => void;

let auditHook: SensitivityAuditHook | null = null;

export function setSensitivityAuditHook(hook: SensitivityAuditHook | null): void {
  auditHook = hook;
}

function audit(evt: SensitivityAuditEvent): void {
  try {
    auditHook?.(evt);
  } catch {
    /* audit must never throw */
  }
}

export interface ClassifyMeta {
  source?: string;
}

/**
 * Heuristic classifier over the single `Sensitivity` taxonomy. Runs the
 * highest-severity patterns first, then falls back to source-based hints,
 * else `public`. Intentionally conservative on false negatives at the top
 * (credential detection) and permissive on false positives at the bottom.
 */
export function classifySensitivity(content: string, meta?: ClassifyMeta): Sensitivity {
  const text = content ?? '';

  if (SECRET_PATTERNS.some((rx) => rx.test(text))) {
    return auditAnd('employer-confidential', meta);
  }

  // Source-hint check happens BEFORE the private-pattern scan so an
  // `employer-code` source stays employer-confidential even when the snippet
  // also happens to include an email in a comment.
  const sourceHint = meta?.source ? SOURCE_HINTS[meta.source] : undefined;
  if (sourceHint === 'employer-confidential') {
    return auditAnd('employer-confidential', meta);
  }

  if (PRIVATE_PATTERNS.some((rx) => rx.test(text))) {
    return auditAnd('personal', meta);
  }

  return auditAnd(sourceHint ?? 'public', meta);
}

function auditAnd(level: Sensitivity, meta?: ClassifyMeta): Sensitivity {
  audit({
    code: 'security.audit.sensitivity_classified',
    level,
    source: meta?.source,
  });
  return level;
}
