import { z } from 'zod';

/**
 * Canonical raw-job shape every adapter emits. Pipeline consumes iterables
 * of `RawJob` and owns everything downstream (normalize → dedupe → land).
 *
 * Adapter-specific field names get mapped into this shape by each adapter's
 * own code. The original payload is stashed on `payload` for provenance +
 * later reprocessing.
 *
 * Walking-skeleton (slice 13): only a subset of the blueprint's full RawJob
 * fields are populated. `comp_raw`, `location_raw` structured extraction,
 * seniority classification etc. land with the analysis slice.
 */
export const RawJobSchema = z.object({
  sourceId: z.string().min(1).max(200),
  sourceName: z.string().min(1).max(60),
  canonicalUrl: z.string().url(),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  location: z.string().max(200).nullable(),
  remote: z.boolean(),
  /**
   * Employer-declared workplace type when the source exposes it (Lever
   * `workplaceType`, Workday `remoteType`, Ashby `isRemote`). Omitted when the
   * source only gives a boolean `remote` — never inferred here.
   */
  workplaceType: z.enum(['remote', 'hybrid', 'onsite']).nullable().optional(),
  description: z.string().min(1).max(50_000),
  sourcePostedAt: z.date().nullable(),
  fetchedAt: z.date(),
  payload: z.unknown(),
});
export type RawJob = z.infer<typeof RawJobSchema>;

/**
 * Adapter contract. Every source (ATS API, aggregator, agent, email) exports
 * one of these. `tier` mirrors the trust order in the blueprint:
 *   1 — VERIFIED ATS (Ashby, Greenhouse)
 *   2 — Aggregator API (Adzuna, Remotive, Arbeitnow, JSearch, Serpapi)
 *   3 — Agent/email (P3.5 / P5)
 */
export type RawWorkplaceType = 'remote' | 'hybrid' | 'onsite';

/**
 * Normalize an employer-declared workplace string to the closed vocabulary.
 * Unknown/empty → undefined so callers never invent a value.
 */
export function normalizeWorkplaceType(
  value: string | null | undefined,
): RawWorkplaceType | undefined {
  if (!value) return undefined;
  const t = value.toLowerCase();
  if (t.includes('remote')) return 'remote';
  if (t.includes('hybrid') || t.includes('flex')) return 'hybrid';
  if (t.includes('onsite') || t.includes('on-site') || t.includes('office')) return 'onsite';
  return undefined;
}

export interface JobSourceAdapter {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** SPDX-like short string describing the data source's terms. */
  licenseHint: string;
  /** Attribution rendered under jobs in the UI. */
  attribution: string;
  fetch(): Promise<RawJob[]>;
}
