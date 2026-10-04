// Job ↔ candidate match scoring. Pure functions only — no DB, no LLM.
//
// This is the SINGLE match implementation. Both the jobs list (`GET /jobs`,
// via `computeMatchResult`) and the job detail (`POST /matcher/score`, via
// `computeMatch`) call it, so the same job/candidate pair can never surface two
// different scores. Moved verbatim out of apps/api matcher.service (C-P4.1) so
// the architecture matches AGENTS.md §12 (… relevance → match → land).
//
// ------ Formulas (single source of truth; keep in sync with tests) ------
//
//   user_prof(s)  = clamp(candidate_skill_state.proficiency / 100, 0..1)
//                   0 when the user has no state row for skill s.
//
//   weight(s)     = job.requiredSkills[s].weight, defaulting to 1.0.
//                   NormalizedJob today stores skillIds as string[] with no
//                   per-skill weight, so every required skill is weighted
//                   equally. When the extractor starts emitting weights,
//                   drop them into the requiredSkills map — no other change.
//
//   score         = Σ min(user_prof(s), 1) * weight(s)  /  Σ weight(s)
//                   over the job's required skills.
//                   0 when the job has no required skills yet (extraction
//                   hasn't run) or when the sum-of-weights is 0.
//
//   recency_factor(s) — bands on `recencyDays` from CandidateSkillState:
//                   d <= 90    -> 1.00
//                   d <= 180   -> 0.75
//                   otherwise  -> 0.50  (also when no state row exists,
//                                        but user_prof is 0 there so the
//                                        contribution vanishes anyway)
//
//   readiness     = Σ min(user_prof(s), 1) * weight(s) * recency_factor(s)
//                    / Σ weight(s)
//                   Always <= score. Equal to score only when every
//                   contributing skill is fresh (<=90d).
//
//   gap           = { skill: required skill s where user_prof(s) < 0.5,
//                     weight, currentProf, deltaNeeded = 0.5 - currentProf }
//
//   explanations  = { kind: 'strong' | 'weak' | 'missing', skill, evidence?, note }
//                   strong  -> user_prof >= 0.7, up to 2 recent evidence rows
//                   weak    -> 0 < user_prof < 0.5
//                   missing -> no state row, or user_prof == 0

const STRONG_PROF = 0.7;
const WEAK_PROF = 0.5;
const RECENCY_FRESH_DAYS = 90;
const RECENCY_STALE_DAYS = 180;
const RECENCY_FRESH = 1.0;
const RECENCY_MID = 0.75;
const RECENCY_OLD = 0.5;
const MAX_EVIDENCE_PER_STRONG = 2;

// Assumed local working window used for timezone-overlap scoring. A single
// shared convention (09:00–17:00 local, 8h) keeps the axis comparable across
// jobs until per-role schedules exist.
const WORK_DAY_START_HOUR = 9;
const WORK_DAY_END_HOUR = 17;
const WORKDAY_HOURS = WORK_DAY_END_HOUR - WORK_DAY_START_HOUR;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Compact match shape returned with each row in the jobs list. Kept separate
 * from the rich `MatchScore` because the list renders only a score + coverage
 * summary, while the detail view renders gap + explanations + evidence.
 */
export interface MatchResult {
  /** null when the job has no extracted skills yet (can't compute). */
  score: number | null;
  /** How many required skills the candidate covers at/above the weak bar. */
  matched: number;
  /** How many skills the job asks for. */
  total: number;
  /** Required skills below the weak bar — sorted for stable UI. */
  missing: string[];
  /**
   * Optional geo fit in [0,1] (workplace + country + remote scope). Omitted
   * unless the caller supplies a `geo` input, so legacy callers are unchanged.
   */
  geoFit?: number | null;
  /**
   * Optional comp fit in [0,1] — emitted only when the job currency equals the
   * profile currency, otherwise null. Never compares across currencies.
   */
  compFit?: number | null;
}

export interface GeoFitJob {
  country?: string | null;
  region?: string | null;
  workplaceType?: string | null;
  remoteScope?: string | null;
  /** IANA zone of the employer, when known. Unknown => tz axis uncomputed. */
  timezone?: string | null;
}

export interface GeoFitProfile {
  countries?: readonly string[];
  workplaceTypes?: readonly string[];
  remoteScopes?: readonly string[];
  /** User's IANA zone (AGENTS §6). Required with `job.timezone` for the axis. */
  timezone?: string | null;
  /** Desired minimum overlap in hours; when absent the axis normalizes by a workday. */
  timezoneOverlapHours?: number | null;
}

export interface GeoFitInput {
  job: GeoFitJob;
  profile: GeoFitProfile;
}

export interface CompFitInput {
  job: { currency?: string | null; min?: number | null; max?: number | null };
  profile: { currency: string; min?: number | null; max?: number | null };
}

export interface GapItem {
  skillId: string;
  skillName: string;
  weight: number;
  currentProf: number;
  deltaNeeded: number;
}

export interface EvidenceRef {
  id: string;
  kind: string;
  signal: string;
  observedAt: string;
}

export interface Explanation {
  kind: 'strong' | 'weak' | 'missing';
  skillId: string;
  skillName: string;
  evidence?: EvidenceRef[];
  note: string;
}

export interface MatchScore {
  jobId: string;
  score: number;
  readiness: number;
  gap: GapItem[];
  explanations: Explanation[];
  computedAt: Date;
  /** See {@link MatchResult.geoFit}; omitted unless a `geo` input is given. */
  geoFit?: number | null;
  /** See {@link MatchResult.compFit}; omitted unless a `comp` input is given. */
  compFit?: number | null;
}

/** Per-skill weight; today always 1.0. Kept as a type so a future
 *  extractor emitting weights drops in without a call-site rewrite. */
export interface RequiredSkill {
  skillId: string;
  weight: number;
}

export interface ComputeInput {
  jobId: string;
  required: RequiredSkill[];
  nameById: Map<string, string>;
  stateBySkill: Map<
    string,
    { proficiency: unknown; recencyDays: number }
  >;
  evidenceBySkill: Map<
    string,
    Array<{ id: string; kind: string; signal: string; observedAt: Date }>
  >;
  now?: Date;
  /** Optional geo fit inputs; omit to keep the legacy output shape. */
  geo?: GeoFitInput;
  /** Optional comp fit inputs; omit to keep the legacy output shape. */
  comp?: CompFitInput;
}

export function computeMatch(input: ComputeInput): MatchScore {
  const { jobId, required, nameById, stateBySkill, evidenceBySkill } = input;
  const now = input.now ?? new Date();
  const extras: Pick<MatchScore, 'geoFit' | 'compFit'> = {};
  if (input.geo) extras.geoFit = computeGeoFit(input.geo);
  if (input.comp) extras.compFit = computeCompFit(input.comp);

  if (required.length === 0) {
    return { jobId, score: 0, readiness: 0, gap: [], explanations: [], computedAt: now, ...extras };
  }

  let sumCoverage = 0;
  let sumReadiness = 0;
  let sumWeights = 0;
  const gap: GapItem[] = [];
  const explanations: Explanation[] = [];

  for (const { skillId, weight } of required) {
    const w = clampUnit(weight);
    sumWeights += w;
    const state = stateBySkill.get(skillId);
    const prof = state ? clampUnit(Number(state.proficiency) / 100) : 0;
    const recency = state ? recencyFactor(state.recencyDays) : RECENCY_OLD;
    sumCoverage += prof * w;
    sumReadiness += prof * w * recency;

    const skillName = nameById.get(skillId) ?? skillId;

    if (!state || prof === 0) {
      gap.push({ skillId, skillName, weight: w, currentProf: 0, deltaNeeded: WEAK_PROF });
      explanations.push({
        kind: 'missing',
        skillId,
        skillName,
        note: `No evidence for ${skillName}; job weight ${w.toFixed(2)}.`,
      });
      continue;
    }

    if (prof < WEAK_PROF) {
      gap.push({
        skillId,
        skillName,
        weight: w,
        currentProf: prof,
        deltaNeeded: WEAK_PROF - prof,
      });
      explanations.push({
        kind: 'weak',
        skillId,
        skillName,
        note: `Proficiency ${prof.toFixed(2)} below bar (${WEAK_PROF.toFixed(2)}); +${(WEAK_PROF - prof).toFixed(2)} needed.`,
      });
      continue;
    }

    if (prof >= STRONG_PROF) {
      const ev = (evidenceBySkill.get(skillId) ?? [])
        .slice(0, MAX_EVIDENCE_PER_STRONG)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          signal: e.signal,
          observedAt: e.observedAt.toISOString(),
        }));
      const expl: Explanation = {
        kind: 'strong',
        skillId,
        skillName,
        note: `Strong: proficiency ${prof.toFixed(2)}, ${ev.length} recent evidence row(s).`,
      };
      if (ev.length > 0) expl.evidence = ev;
      explanations.push(expl);
      continue;
    }

    // Middle band: covered but below "strong". No gap, no note noise.
    explanations.push({
      kind: 'weak',
      skillId,
      skillName,
      note: `Covered at ${prof.toFixed(2)} (weight ${w.toFixed(2)}); short of strong.`,
    });
  }

  const score = sumWeights > 0 ? sumCoverage / sumWeights : 0;
  const readiness = sumWeights > 0 ? sumReadiness / sumWeights : 0;
  return {
    jobId,
    score: clampUnit(score),
    readiness: clampUnit(readiness),
    gap,
    explanations,
    computedAt: now,
    ...extras,
  };
}

/**
 * Geo fit: the mean of the axes the profile actually constrains. An absent
 * profile axis contributes nothing (so it can't punish an unset preference);
 * a job value that's unknown scores 0.5 (neither match nor mismatch). Returns
 * null when no axis can be scored.
 *
 * The timezone axis is scored only when BOTH the job and the profile carry an
 * IANA zone — an unknown job timezone leaves the axis uncomputed rather than
 * fabricating a 0. The score is the DST-correct overlap between the two
 * 09:00–17:00 local windows, normalized by the desired overlap (when set) or by
 * an 8-hour workday.
 */
export function computeGeoFit(input: GeoFitInput): number | null {
  const { job, profile } = input;
  const parts: number[] = [];

  if (profile.countries && profile.countries.length > 0) {
    parts.push(matchScore(job.country ?? null, profile.countries));
  }
  if (profile.workplaceTypes && profile.workplaceTypes.length > 0) {
    parts.push(matchScore(job.workplaceType ?? null, profile.workplaceTypes));
  }
  if (profile.remoteScopes && profile.remoteScopes.length > 0) {
    parts.push(matchScore(job.remoteScope ?? null, profile.remoteScopes));
  }
  if (profile.timezone && job.timezone) {
    const overlap = timezoneOverlapHours(profile.timezone, job.timezone);
    const desired = profile.timezoneOverlapHours;
    parts.push(
      desired && desired > 0
        ? clampUnit(overlap / desired)
        : clampUnit(overlap / WORKDAY_HOURS),
    );
  }

  if (parts.length === 0) return null;
  return clampUnit(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/**
 * DST-correct overlap (hours, 0..8) between the user's and the job's local
 * 09:00–17:00 working windows. The offsets are read for the given `at` date via
 * `Intl`, so a January and a July instant can legitimately differ even for the
 * same pair of zones. Pure; never throws for valid IANA zones.
 */
export function timezoneOverlapHours(
  userTimezone: string,
  jobTimezone: string,
  at: Date = new Date(),
): number {
  const userOffset = zoneOffsetMinutes(userTimezone, at);
  const jobOffset = zoneOffsetMinutes(jobTimezone, at);
  const userStart = WORK_DAY_START_HOUR * 60 - userOffset;
  const userEnd = WORK_DAY_END_HOUR * 60 - userOffset;
  const jobStart = WORK_DAY_START_HOUR * 60 - jobOffset;
  const jobEnd = WORK_DAY_END_HOUR * 60 - jobOffset;
  return intervalOverlapMinutes(userStart, userEnd, jobStart, jobEnd) / 60;
}

/** UTC offset (minutes east of UTC) of an IANA zone at instant `at`. */
function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    num('hour'),
    num('minute'),
    num('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Overlap of two fixed windows, tolerant of windows that wrap UTC midnight. */
function intervalOverlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  let best = 0;
  for (const shift of [-MINUTES_PER_DAY, 0, MINUTES_PER_DAY]) {
    const lo = Math.max(aStart, bStart + shift);
    const hi = Math.min(aEnd, bEnd + shift);
    if (hi > lo) best = Math.max(best, hi - lo);
  }
  return best;
}

/**
 * Comp fit: overlap of the job band with the target band, only when the
 * currencies match. Different (or unknown) currencies → null; the relevance
 * layer surfaces `comp_uncomparable` so the caller can explain why.
 */
export function computeCompFit(input: CompFitInput): number | null {
  const { job, profile } = input;
  if (!job.currency || job.currency.toUpperCase() !== profile.currency.toUpperCase()) {
    return null;
  }
  if (job.min == null || job.max == null || profile.min == null || profile.max == null) {
    return null;
  }
  const lo = Math.max(job.min, profile.min);
  const hi = Math.min(job.max, profile.max);
  if (hi <= lo) return 0;
  const overlap = hi - lo;
  const span = Math.max(job.max, profile.max) - Math.min(job.min, profile.min);
  return span > 0 ? clampUnit(overlap / span) : 1;
}

function matchScore(value: string | null, targets: readonly string[]): number {
  if (!value) return 0.5;
  return targets.includes(value) ? 1 : 0;
}

/**
 * Jobs-list projection over `computeMatch`: runs the canonical weighted scorer
 * and flattens it to the compact per-row shape. `score` is therefore identical
 * to the detail view's `score` for the same job + candidate state. Returns
 * `score: null` when the job has no extracted skills (old list behaviour —
 * a 0% score there would be misleading).
 */
export function computeMatchResult(input: ComputeInput): MatchResult {
  if (input.required.length === 0) {
    const empty: MatchResult = { score: null, matched: 0, total: 0, missing: [] };
    if (input.geo) empty.geoFit = computeGeoFit(input.geo);
    if (input.comp) empty.compFit = computeCompFit(input.comp);
    return empty;
  }
  const score = computeMatch(input);
  const missing = score.gap.map((g) => g.skillId).sort();
  const result: MatchResult = {
    score: score.score,
    matched: input.required.length - missing.length,
    total: input.required.length,
    missing,
  };
  // Only surface geo/comp fit when the caller supplied the inputs, so legacy
  // callers keep byte-identical output.
  if (score.geoFit !== undefined) result.geoFit = score.geoFit;
  if (score.compFit !== undefined) result.compFit = score.compFit;
  return result;
}

function recencyFactor(recencyDays: number): number {
  // Aggregator uses -1 as "never seen"; treat as stale.
  if (recencyDays < 0) return RECENCY_OLD;
  if (recencyDays <= RECENCY_FRESH_DAYS) return RECENCY_FRESH;
  if (recencyDays <= RECENCY_STALE_DAYS) return RECENCY_MID;
  return RECENCY_OLD;
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
