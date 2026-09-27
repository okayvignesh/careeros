// Sensitivity labels + inference. Every piece of user data carries one of these
// so the sensitivity gate can decide which providers may see it.
//
// Labels form a strict ordering: public < personal < confidential < employer-confidential.
// A provider policy that "allows confidential" implicitly allows everything looser.
import type { UntrustedSourceKind } from './wrap';

export const SENSITIVITY_LEVELS = ['public', 'personal', 'confidential', 'employer-confidential'] as const;
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

const RANK: Record<Sensitivity, number> = {
  public: 0,
  personal: 1,
  confidential: 2,
  'employer-confidential': 3,
};

export function rankOf(level: Sensitivity): number {
  return RANK[level];
}

export function isAtLeast(actual: Sensitivity, minimum: Sensitivity): boolean {
  return RANK[actual] >= RANK[minimum];
}

/**
 * Conservative default mapping from an untrusted-source kind to a sensitivity label.
 * Callers can override per-item once we have a real settings UI (screen 52 in slice 5c+).
 *
 * Defaults tuned so mistakes fail closed:
 *   - resume + email → personal (biographic)
 *   - readme / job-description / company-page → public (no assumption of confidentiality)
 *   - code → confidential by default (source may be proprietary; upgrade to
 *     employer-confidential per-repo in slice 5c settings UI)
 *   - user-input + comment → personal
 */
export function defaultSensitivityForSource(kind: UntrustedSourceKind): Sensitivity {
  switch (kind) {
    case 'resume':
    case 'email':
    case 'user-input':
    case 'comment':
      return 'personal';
    case 'readme':
    case 'job-description':
    case 'company-page':
      return 'public';
    case 'code':
      return 'confidential';
  }
}
