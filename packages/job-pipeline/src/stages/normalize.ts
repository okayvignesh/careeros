import type { SponsorshipSignal } from '@careeros/shared';
import type { RawJob, RawWorkplaceType } from '../types';
import { classifySeniority, type SeniorityResult } from './classify-seniority';
import { classifyRole, type RoleResult } from './classify-role';
import { parseCompBand } from './comp-band';
import { convertToUsdBand, type CompBand, type CompBandUsd } from '../fx/rates';
import { parseLocation, sponsorshipSignal } from './geo';

/**
 * Persistence-ready shape produced by `normalize(raw)`. Mirrors the columns on
 * Prisma model `NormalizedJob` that the pipeline actually populates from a
 * `RawJob`. State-machine columns (`state`, `skillIds`, `skillsExtractedAt`,
 * `firstSeenAt`, `lastVerifiedAt`) are DB-owned and NOT set here — the service
 * layer applies its own defaults / update-only-on-existing rules.
 *
 * C-P3.3 additions: `seniority`, `role`, `compBandOriginal`, `compBandUsd`,
 * `compCurrency`. All nullable — a job without a salary string has no comp
 * band, and every heuristic can bail. Backward-compat: every field that was
 * here before still lives here.
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
  // --- C-P3.3 analysis signals ---
  /** Seniority level + confidence + reasons. */
  seniority: SeniorityResult;
  /** Job family + confidence + reasons. */
  role: RoleResult;
  /** Parsed comp band in original currency; null if salary text absent/unparseable. */
  compBandOriginal: CompBand | null;
  /** Same band normalized to USD/year; null if currency unknown to FX table. */
  compBandUsd: CompBandUsd | null;
  /** ISO currency code from the parsed band (redundant w/ compBandOriginal.currency but keeps a flat column for DB indexing). */
  compCurrency: string | null;
  // --- P1 job-targeting geo signals (job-targeting-design.md §5) ---
  /** ISO-3166 alpha-2, only when established by an explicit token. */
  country: string | null;
  region: string | null;
  city: string | null;
  /** Employer-declared workplace type; null when the source only gives a boolean. */
  workplaceType: RawWorkplaceType | null;
  /** Local/regional/global remote scope, when the listing states one. */
  remoteScope: string | null;
  /** `likely | unclear | none`; never defaults to `likely`. */
  sponsorshipSignal: SponsorshipSignal;
  /** Evidence for a non-`unclear` signal; null when there was no signal. */
  sponsorshipEvidence: SponsorshipEvidence | null;
  /** When `parseLocation`/`sponsorshipSignal` last ran for this row. */
  geoParsedAt: Date;
}

export interface SponsorshipEvidence {
  value: SponsorshipSignal;
  matched: string[];
  source: 'description';
  confidence: number;
  parsedAt: string;
}

/**
 * Optional per-row extension the pipeline can accept from an adapter. Not on
 * RawJobSchema today because adapters land salary text in different places
 * (Adzuna: `salary_min`/`salary_max` numeric; Remotive: `salary` string; Ashby:
 * `compensation` object). Callers extract into `salaryText` before invoking
 * normalize; today `jobs.service.sync` passes undefined and comp parsing bails.
 */
export interface NormalizeInput {
  raw: RawJob;
  salaryText?: string | null;
  /** Geo parse timestamp; defaults to `new Date()`. Tests pass a fixed value. */
  now?: Date;
}

/**
 * Pure map RawJob → NormalizedJob. Extracted from jobs.service `sync()` where
 * this was inline. No IO. Extended in C-P3.3 to run three classifiers +
 * FX-convert the comp band. All classifier calls are pure and cheap — a
 * regex-per-family scan over 500 chars.
 *
 * Overload: keeps the old `normalize(raw)` shape for existing callers.
 * `normalize({ raw, salaryText })` is the new form.
 */
export function normalize(input: RawJob): NormalizedJob;
export function normalize(input: NormalizeInput): NormalizedJob;
export function normalize(input: RawJob | NormalizeInput): NormalizedJob {
  const raw: RawJob = 'raw' in input ? input.raw : input;
  const salaryText: string | null | undefined = 'raw' in input ? input.salaryText : undefined;
  // Deterministic by default: reuse the raw fetch timestamp so two calls with
  // the same raw produce identical output (purity contract). Callers that want
  // a batch-shared timestamp pass `now`.
  const now: Date = ('raw' in input ? input.now : undefined) ?? raw.fetchedAt ?? new Date();

  const seniority = classifySeniority(raw.title, raw.description);
  const role = classifyRole(raw.title, raw.description);
  const compBandOriginal = parseCompBand(salaryText ?? null);
  const compBandUsd = compBandOriginal ? convertToUsdBand(compBandOriginal) : null;

  const geo = parseLocation(raw.location);
  // Employer-declared workplaceType wins over a token parsed from the location.
  const workplaceType = raw.workplaceType ?? geo.workplaceType ?? null;
  const sponsorship = sponsorshipSignal(raw.description);
  const sponsorshipEvidence: SponsorshipEvidence | null =
    sponsorship.value === 'unclear'
      ? null
      : {
          value: sponsorship.value,
          matched: sponsorship.matched,
          source: 'description',
          confidence: sponsorship.confidence,
          parsedAt: now.toISOString(),
        };

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
    seniority,
    role,
    compBandOriginal,
    compBandUsd,
    compCurrency: compBandOriginal?.currency ?? null,
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    workplaceType,
    remoteScope: geo.remoteScope ?? null,
    sponsorshipSignal: sponsorship.value,
    sponsorshipEvidence,
    geoParsedAt: now,
  };
}
