import type { RawJob } from '../types';
import { classifySeniority, type SeniorityResult } from './classify-seniority';
import { classifyRole, type RoleResult } from './classify-role';
import { parseCompBand } from './comp-band';
import { convertToUsdBand, type CompBand, type CompBandUsd } from '../fx/rates';

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

  const seniority = classifySeniority(raw.title, raw.description);
  const role = classifyRole(raw.title, raw.description);
  const compBandOriginal = parseCompBand(salaryText ?? null);
  const compBandUsd = compBandOriginal ? convertToUsdBand(compBandOriginal) : null;

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
  };
}
