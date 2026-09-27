// Sensitivity gate — C-P0.3 (see plan/ai-safety.md item 8, plan/phase-0-install.md:86-90).
//
// Two orthogonal jobs live here:
//   1. classify(): heuristic label for a chunk of untrusted content
//      → SensitivityLevel = public | private | employer-confidential | system-secret.
//   2. assertAllowed(): compare a classified level against the trust ceiling of
//      the dispatch context (llm-external, llm-local, log, browser-agent,
//      outbound-email). Throws SensitivityBlockedError when a call would leak
//      higher-sensitivity content into a lower-trust sink.
//
// The re-auth window is a per-(userId, opTag) timestamp; hasFreshReauth returns
// true within `windowMs` of the last recordReauth(). No DB — a Map keeps the
// impl trivially testable and single-process is the only shape until multi-user
// arrives. ponytail: Map is fine until we horizontally scale the api; then
// swap for a redis SETEX (10 lines).
//
// This module is deliberately independent of the existing packages/ai/src/sensitivity.ts
// (which owns the older 4-label data-classification taxonomy consumed by the
// api's SensitivityGateService/AppConfig policy). Both coexist until the api
// migrates on top of this gate — different scopes, different consumers.
//
// Injectable audit hook lets the api pipe every decision into pino / audit_log
// without dragging a logger dependency into packages/ai.

import { SensitivityBlockedError } from './errors';

/** Ordered least-sensitive → most-sensitive; ordering IS the semantics. */
export const SENSITIVITY_LEVELS = [
  'public',
  'private',
  'employer-confidential',
  'system-secret',
] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

/** Dispatch contexts, in trust-ceiling order (least trusted → most trusted).
 *  A context can only *receive* content whose sensitivity is ≤ its ceiling. */
export type SensitivityContext =
  | 'llm-external' // third-party LLM API (deepseek, openai, anthropic, ...)
  | 'llm-local' // ollama / on-host model
  | 'log' // audit_log / pino / stdout
  | 'browser-agent' // desktop companion agent (P3.5) driving a browser
  | 'outbound-email'; // Gmail draft / send

// A higher number = the context can safely see MORE-sensitive content.
// system-secret means "never leaves the process boundary" → no context accepts it
// by default. If the operator needs to route a secret to llm-local (e.g. debugging
// a local model), they must escalate via withReauthWindow + explicit UI confirm.
const LEVEL_RANK: Record<SensitivityLevel, number> = {
  public: 0,
  private: 1,
  'employer-confidential': 2,
  'system-secret': 3,
};

const CONTEXT_CEILING: Record<SensitivityContext, number> = {
  'llm-external': LEVEL_RANK.public, // externally hosted → public only
  'outbound-email': LEVEL_RANK.private, // user-authored, private OK
  log: LEVEL_RANK.private, // structured logs, private OK; secrets never
  'browser-agent': LEVEL_RANK.private, // agent drives untrusted DOM → private cap
  'llm-local': LEVEL_RANK['employer-confidential'], // on-host model may see employer code
};

// ---------------------------------------------------------------------------
// Classifier heuristics. Order matters: highest-severity match wins.
// ponytail: regexes only. If we need semantic classification we plug an LLM
// pass in `classifySemantic()`, not here.
// ---------------------------------------------------------------------------

// system-secret — anything that looks like a credential.
// Anchored to reduce false positives on "The password field..." prose.
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-~+/=]{16,}/i, // Authorization: Bearer ...
  /\b(?:sk|pk|rk|xoxp|xoxb|ghp|gho|ghu|ghs|ghr|glpat)[-_][A-Za-z0-9_\-]{16,}/, // API keys (OpenAI, Slack, GitHub, GitLab)
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT-shaped
];

// private — PII-shaped patterns. Emails + phones + national IDs.
const PRIVATE_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // NA-format phone
  /\+\d{1,3}\s?\d{4,14}\b/, // E.164-ish
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
];

/** Some ingest sources have a static sensitivity floor regardless of content.
 *  These are hints for classify(meta.source) — content scan still runs and
 *  wins if it detects something higher. */
const SOURCE_HINTS: Record<string, SensitivityLevel> = {
  // Employer-confidential surfaces.
  'private-repo': 'employer-confidential',
  'employer-code': 'employer-confidential',
  'internal-doc': 'employer-confidential',
  'company-code': 'employer-confidential',
  // Private surfaces.
  resume: 'private',
  email: 'private',
  'user-input': 'private',
  comment: 'private',
  // Public surfaces (explicit for documentation; falls through anyway).
  'public-repo': 'public',
  'job-description': 'public',
  readme: 'public',
  'company-page': 'public',
};

// ---------------------------------------------------------------------------
// Audit hook — every decision surfaces here so the api can persist to
// audit_log / pino without packages/ai learning about them.
// ---------------------------------------------------------------------------

export interface SensitivityAuditEvent {
  code: 'security.audit.sensitivity_classified' | 'security.audit.sensitivity_blocked';
  level: SensitivityLevel;
  context?: SensitivityContext | undefined;
  source?: string | undefined;
  reason?: string | undefined;
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

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface ClassifyMeta {
  source?: string;
}

export class SensitivityGate {
  /** Per-(userId + opTag) timestamp (ms epoch) of the last recorded re-auth. */
  private readonly reauth = new Map<string, number>();

  /**
   * Heuristic classifier. Runs the highest-severity patterns first, then falls
   * back to source-based hints, else `public`. This is intentionally
   * conservative on false negatives at the top (secret detection) and
   * permissive on false positives at the bottom (public default).
   */
  classify(content: string, meta?: ClassifyMeta): SensitivityLevel {
    const text = content ?? '';

    if (SECRET_PATTERNS.some((rx) => rx.test(text))) {
      audit({
        code: 'security.audit.sensitivity_classified',
        level: 'system-secret',
        source: meta?.source,
      });
      return 'system-secret';
    }

    // Source-hint check happens BEFORE the private-pattern scan so an
    // `employer-code` source stays employer-confidential even when the
    // snippet also happens to include an email in a comment.
    const sourceHint = meta?.source ? SOURCE_HINTS[meta.source] : undefined;
    if (sourceHint === 'employer-confidential') {
      audit({
        code: 'security.audit.sensitivity_classified',
        level: 'employer-confidential',
        source: meta?.source,
      });
      return 'employer-confidential';
    }

    if (PRIVATE_PATTERNS.some((rx) => rx.test(text))) {
      audit({
        code: 'security.audit.sensitivity_classified',
        level: 'private',
        source: meta?.source,
      });
      return 'private';
    }

    const fallback: SensitivityLevel = sourceHint ?? 'public';
    audit({
      code: 'security.audit.sensitivity_classified',
      level: fallback,
      source: meta?.source,
    });
    return fallback;
  }

  /**
   * Throws SensitivityBlockedError if the requested context does not meet the
   * required trust level. Silent (no audit) on success so callers do not need
   * an opt-out for happy-path noise.
   */
  assertAllowed(level: SensitivityLevel, ctx: SensitivityContext): void {
    const contentRank = LEVEL_RANK[level];
    const ceiling = CONTEXT_CEILING[ctx];
    if (contentRank > ceiling) {
      const reason = `content ceiling for context '${ctx}' is rank ${ceiling}; content is rank ${contentRank}`;
      audit({
        code: 'security.audit.sensitivity_blocked',
        level,
        context: ctx,
        reason,
      });
      throw new SensitivityBlockedError(level, ctx, reason);
    }
  }

  /**
   * Record a fresh re-auth for a given user + operation tag. Callers wire this
   * into the passkey / password re-verify path immediately after success. The
   * returned handle lets a test / debug tool inspect the deadline; production
   * callers ignore it.
   */
  withReauthWindow(userId: string, opTag: string, windowMs = 300_000): { expiresAt: number } {
    const now = Date.now();
    const expiresAt = now + windowMs;
    // Store expiresAt directly — cheaper check than (now - stored < windowMs)
    // and future-proofs per-op window overrides without a schema change.
    this.reauth.set(reauthKey(userId, opTag), expiresAt);
    return { expiresAt };
  }

  /** True iff withReauthWindow(userId, opTag, ...) fired within its window. */
  hasFreshReauth(userId: string, opTag: string): boolean {
    const expiresAt = this.reauth.get(reauthKey(userId, opTag));
    if (expiresAt == null) return false;
    if (Date.now() >= expiresAt) {
      // Drop stale entries opportunistically; Map stays small on a single-user host.
      this.reauth.delete(reauthKey(userId, opTag));
      return false;
    }
    return true;
  }

  /** Test / debug helper — never called from prod code paths. */
  _clearReauth(): void {
    this.reauth.clear();
  }
}

function reauthKey(userId: string, opTag: string): string {
  return `${userId} ${opTag}`;
}

/** Re-export for callers that only need the error type. */
export { SensitivityBlockedError } from './errors';
