/**
 * F7/F8 shared ingest plan. Runs the persistence-agnostic prefix of the
 * universal pipeline — normalize → cross-source dedupe → verify — and returns
 * exactly what a persistence layer must write:
 *
 *   - `normalized`  survivors (trusted or flagged) for `jobs_normalized`
 *   - `rejected`    verify() hard-fails for `job_reject_log`
 *   - `mergedSourceTagsByWinner` provenance tags folded by dedupe
 *
 * Freshness, relevance and match scoring stay read-time stages (see
 * JobsService.list): preferences change and the listing must re-evaluate
 * without a re-ingest. The worker reports those counts for observability only.
 *
 * Source adapters still own raw provenance: callers append to `jobs_raw`
 * before invoking this, so nothing is normalized before its raw row exists.
 */
import type { RawJob } from '../types';
import { normalize, type NormalizedJob } from './normalize';
import { crossSourceDedupe, type DuplicatePair } from './cross-source-dedupe';
import { verify } from './verify';

export interface RejectedIngestRow {
  sourceId: string;
  sourceName: string;
  reason: string;
  details: {
    reasons: string[];
    canonicalUrl: string;
    title: string;
    company: string;
    rawJd: string;
    sourcePostedAt: string | null;
  };
}

/** Pipeline state promoted from the verify verdict. `verified` gates apply. */
export type PromotedState = 'verified' | 'discovered';

export interface IngestPlan {
  /** Deduped, verify-surviving rows ready to upsert into `jobs_normalized`. */
  normalized: NormalizedJob[];
  /** Hard-failed rows, one reject-log entry each. */
  rejected: RejectedIngestRow[];
  /** Per-winner source tags (winner + folded losers) for `sourceIds`. */
  mergedSourceTagsByWinner: Map<NormalizedJob, string[]>;
  /**
   * Verify verdict promoted to `NormalizedJob.state` (lowercase): `trusted` →
   * `verified`, `flagged` → `discovered`. Rejected rows are excluded entirely.
   */
  stateByWinner: Map<NormalizedJob, PromotedState>;
  /** Pairs folded away by cross-source dedupe (for stats/audit). */
  duplicates: DuplicatePair[];
}

export function planIngest(raws: RawJob[], opts: { now?: Date } = {}): IngestPlan {
  const geoNow = opts.now ?? new Date();
  const normalizedAll = raws.map((r) => normalize({ raw: r, now: geoNow }));
  const dedupeResult = crossSourceDedupe(normalizedAll);

  const normalized: NormalizedJob[] = [];
  const rejected: RejectedIngestRow[] = [];
  const stateByWinner = new Map<NormalizedJob, PromotedState>();
  for (const n of dedupeResult.unique) {
    const verdict = verify(n);
    if (verdict.verdict === 'rejected') {
      rejected.push({
        sourceId: extractSourceIdFromTag(n.sourceTag),
        sourceName: n.primarySource,
        reason: verdict.reasons[0] ?? 'unknown',
        details: {
          reasons: verdict.reasons,
          canonicalUrl: n.canonicalUrl,
          title: n.title,
          company: n.company,
          rawJd: n.description,
          sourcePostedAt: n.sourcePostedAt?.toISOString() ?? null,
        },
      });
      continue;
    }
    normalized.push(n);
    stateByWinner.set(n, verdict.verdict === 'trusted' ? 'verified' : 'discovered');
  }

  return {
    normalized,
    rejected,
    mergedSourceTagsByWinner: dedupeResult.mergedSourceTagsByWinner,
    stateByWinner,
    duplicates: dedupeResult.duplicates,
  };
}

/** `sourceTag = "${sourceName}:${sourceId}"`; recover the adapter-native id. */
function extractSourceIdFromTag(sourceTag: string): string {
  const idx = sourceTag.indexOf(':');
  return idx >= 0 ? sourceTag.slice(idx + 1) : sourceTag;
}
