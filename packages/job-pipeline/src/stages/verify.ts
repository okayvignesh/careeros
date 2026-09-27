import type { NormalizedJob } from './normalize';

export type VerifyVerdict = 'trusted' | 'flagged';

export interface VerifyOpts {
  /**
   * Adapter ids the caller considers Tier-1 VERIFIED ATS (Ashby, Greenhouse,
   * ...). Anything from a source in this set gets a `trusted` verdict unless
   * a hard-fail rule fires. Defaults to `[]` so callers must opt sources in
   * — the walking-skeleton has no Tier-1 adapters yet.
   */
  trustedSources?: readonly string[];
  /**
   * Minimum description length before we consider a listing substantive.
   * Anything shorter is flagged `thin-description`. Default 40 chars — a
   * one-liner "Senior engineer wanted" is not a real posting.
   */
  minDescriptionChars?: number;
}

export interface VerifyResult {
  verdict: VerifyVerdict;
  reasons: string[];
}

const DEFAULT_MIN_DESC = 40;

/**
 * Pure verify stage. Emits `flagged` if the row trips any hard-fail rule;
 * `trusted` iff the source is in `trustedSources` AND no hard-fail fires;
 * otherwise `flagged` with an `unverified-source` reason. Behavior-neutral
 * to the current pre-refactor service: the service does NOT call this — every
 * new row still lands `state='unverified'` in the DB. The pipeline exposes
 * verify so the P3 verification-stage slice (C-P3.2) can wire it up without
 * re-implementing the rules.
 *
 * Rules (all pure, no IO):
 *   - `title` blank / whitespace → flagged `blank-title`
 *   - `company` blank / whitespace → flagged `blank-company`
 *   - `canonicalUrl` not https/http → flagged `non-http-url`
 *   - `description.length < minDescriptionChars` → flagged `thin-description`
 *   - `primarySource` NOT in `trustedSources` → flagged `unverified-source`
 *
 * A row that hits zero rules AND has a trusted source → `trusted`.
 * A row that hits any hard-fail rule → `flagged` with all matching reasons.
 */
export function verify(job: NormalizedJob, opts: VerifyOpts = {}): VerifyResult {
  const reasons: string[] = [];
  const minDesc = opts.minDescriptionChars ?? DEFAULT_MIN_DESC;
  const trusted = new Set(opts.trustedSources ?? []);

  if (job.title.trim().length === 0) reasons.push('blank-title');
  if (job.company.trim().length === 0) reasons.push('blank-company');
  if (!isHttpUrl(job.canonicalUrl)) reasons.push('non-http-url');
  if (job.description.length < minDesc) reasons.push('thin-description');
  if (!trusted.has(job.primarySource)) reasons.push('unverified-source');

  const verdict: VerifyVerdict = reasons.length === 0 ? 'trusted' : 'flagged';
  return { verdict, reasons };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
