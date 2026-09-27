import type { RawJob } from '../types';

/**
 * Persistence-ready shape produced by `normalize(raw)`. Mirrors the columns on
 * Prisma model `NormalizedJob` that the pipeline actually populates from a
 * `RawJob`. State-machine columns (`state`, `skillIds`, `skillsExtractedAt`,
 * `firstSeenAt`, `lastVerifiedAt`) are DB-owned and NOT set here — the service
 * layer applies its own defaults / update-only-on-existing rules.
 */
export interface NormalizedJob {
  canonicalUrl: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  description: string;
  sourcePostedAt: Date | null;
  /** Adapter id that produced this row. */
  primarySource: string;
  /** `${sourceName}:${sourceId}` tag emitted for provenance. */
  sourceTag: string;
}

/**
 * Pure map RawJob → NormalizedJob. Extracted from jobs.service `sync()` where
 * this was inline. No IO. No trimming — adapters already validate via the Zod
 * schema on their side; if a raw slips through with bad shape it's a bug in
 * the adapter, not here.
 *
 * ponytail: no field normalization (case, whitespace, currency) yet. The
 * P3 analysis slice adds title/seniority classification and `location_raw`
 * parsing; that's where trimming/casing lands too.
 */
export function normalize(raw: RawJob): NormalizedJob {
  return {
    canonicalUrl: raw.canonicalUrl,
    title: raw.title,
    company: raw.company,
    location: raw.location,
    remote: raw.remote,
    description: raw.description,
    sourcePostedAt: raw.sourcePostedAt,
    primarySource: raw.sourceName,
    sourceTag: `${raw.sourceName}:${raw.sourceId}`,
  };
}
