// Blueprint §5.4 skill-state rules as pure functions.
// Signals are recorded as `Evidence`. The aggregator picks a rule per evidence, applies it,
// and produces a new `SkillState`. Never mutate inputs.

export type EvidenceKind = 'self' | 'document' | 'code' | 'assessment' | 'behavioral' | 'outcome';

export type EvidenceSignal =
  | 'correct-independent' // solved without hints
  | 'correct-hinted' // solved with a hint
  | 'partial-correct' // partially right; may carry reasoningQuality 0..1
  | 'incorrect-with-correction' // got it wrong then absorbed the correction
  | 'repeated-failure' // failed N times in a row
  | 'sustained-application' // code / on-the-job usage over time
  | 'presence'; // fact of use without correctness axis (e.g. "React in resume")

export interface Evidence {
  kind: EvidenceKind;
  signal: EvidenceSignal;
  observedAt: Date;
  weightHint?: number; // override kind default, clamped [0..1]
  reasoningQuality?: number; // 0..1 for partial-correct
  streakLength?: number; // for sustained-application / repeated-failure
}

export interface SkillState {
  proficiency: number; // 0..100
  confidence: number; // 0..1
  recencyDays: number; // days since most recent evidence; Infinity if never
  historicalDemonstrated: boolean; // monotonic: was ever demonstrated
  evidenceCount: number;
}

export interface RuleResult {
  next: SkillState;
  rule: string;
  reason: string;
}

// -------- constants --------

export const EMPTY_STATE: SkillState = {
  proficiency: 0,
  confidence: 0,
  recencyDays: Infinity,
  historicalDemonstrated: false,
  evidenceCount: 0,
};

// Blueprint §5.4 evidence-strength defaults; overridable via app_config in future.
export const EVIDENCE_WEIGHT: Record<EvidenceKind, number> = {
  self: 0.3,
  document: 0.5,
  code: 0.7,
  assessment: 1.0,
  behavioral: 0.4,
  outcome: 1.0,
};

// Confidence changes conservatively: never crank confidence higher than proficiency evidence supports.
const CONFIDENCE_STEP = 0.08;
const RUSTY_AFTER_DAYS = 180;
// Confidence is capped (not multiplied) to this ceiling when the skill is stale.
// Idempotent: applying longInactivity twice yields the same state.
const RUSTY_CONFIDENCE_CEILING = 0.25;

// -------- rules --------

export function correctIndependent(state: SkillState, ev: Evidence): RuleResult {
  const w = weight(ev);
  const gain = 8 * w; // strong+
  return {
    next: bump(state, ev, {
      proficiency: clampProficiency(state.proficiency + gain),
      confidence: clampUnit(state.confidence + CONFIDENCE_STEP * w),
      historicalDemonstrated: true,
    }),
    rule: 'correctIndependent',
    reason: `Solved without hints (${ev.kind}, w=${w.toFixed(2)}, +${gain.toFixed(1)})`,
  };
}

export function correctHinted(state: SkillState, ev: Evidence): RuleResult {
  const w = weight(ev);
  const gain = 3.2 * w; // smaller+
  return {
    next: bump(state, ev, {
      proficiency: clampProficiency(state.proficiency + gain),
      confidence: clampUnit(state.confidence + CONFIDENCE_STEP * w * 0.4),
      historicalDemonstrated: true,
    }),
    rule: 'correctHinted',
    reason: `Solved with a hint (${ev.kind}, w=${w.toFixed(2)}, +${gain.toFixed(1)})`,
  };
}

export function partialCorrect(state: SkillState, ev: Evidence): RuleResult {
  const w = weight(ev);
  const q = clampUnit(ev.reasoningQuality ?? 0.5); // neutral when unknown
  const gain = 4 * w * q; // small+ scaled by reasoning quality
  return {
    next: bump(state, ev, {
      proficiency: clampProficiency(state.proficiency + gain),
      confidence: clampUnit(state.confidence + CONFIDENCE_STEP * w * (q - 0.5)),
    }),
    rule: 'partialCorrect',
    reason: `Partial answer (${ev.kind}, quality=${q.toFixed(2)}, +${gain.toFixed(1)})`,
  };
}

export function incorrectWithCorrection(state: SkillState, ev: Evidence): RuleResult {
  // No proficiency jump. Record only that a correction was absorbed.
  const w = weight(ev);
  return {
    next: bump(state, ev, {
      // Slight confidence dip: the miss reveals uncertainty, but historical proficiency stays.
      confidence: clampUnit(state.confidence - CONFIDENCE_STEP * 0.5 * w),
    }),
    rule: 'incorrectWithCorrection',
    reason: `Corrected after miss (${ev.kind}, w=${w.toFixed(2)}, no proficiency change)`,
  };
}

export function repeatedFailure(state: SkillState, ev: Evidence): RuleResult {
  const w = weight(ev);
  const streak = Math.max(2, ev.streakLength ?? 2);
  const conf = clampUnit(state.confidence - CONFIDENCE_STEP * w * Math.log2(streak));
  return {
    next: bump(state, ev, { confidence: conf }),
    rule: 'repeatedFailure',
    reason: `Repeated failure ×${streak} (${ev.kind}); confidence lowered, remediation task recommended`,
  };
}

/**
 * Zero-proof mention (resume text, README listing). Records the claim exists but
 * does NOT touch proficiency — an unverified claim can't grant skill. Historical is
 * left alone too; a mention isn't demonstration. Only evidenceCount + recency move.
 */
export function presence(state: SkillState, ev: Evidence): RuleResult {
  return {
    next: bump(state, ev, {}),
    rule: 'presence',
    reason: `Mention only (${ev.kind}); no proficiency change until proof arrives`,
  };
}

export function sustainedApplication(state: SkillState, ev: Evidence): RuleResult {
  const w = weight(ev);
  const streak = Math.max(1, ev.streakLength ?? 1);
  const gain = 6 * w * Math.log2(streak + 1);
  return {
    next: bump(state, ev, {
      proficiency: clampProficiency(state.proficiency + gain),
      confidence: clampUnit(state.confidence + CONFIDENCE_STEP * w),
      historicalDemonstrated: true,
    }),
    rule: 'sustainedApplication',
    reason: `Sustained application ×${streak} (${ev.kind}, +${gain.toFixed(1)})`,
  };
}

/**
 * Time-based rule. Applied by the aggregator after processing evidence.
 * Does NOT touch historicalDemonstrated or proficiency: rusty is a *readiness* signal.
 * Only confidence takes the hit.
 *
 * IDEMPOTENT: the rusty cut is a FLOOR CAP, not a multiplier. Re-aggregating a stale
 * skill returns the same value; it can't compound down to zero. If we ever want a
 * gradient (rustier over time), do it by ramping the ceiling, not by re-multiplying.
 */
export function longInactivity(state: SkillState, now: Date, lastObservedAt: Date | null): RuleResult {
  const days = lastObservedAt ? daysBetween(now, lastObservedAt) : Infinity;
  if (days < RUSTY_AFTER_DAYS) {
    return {
      next: { ...state, recencyDays: Number.isFinite(days) ? Math.round(days) : Infinity },
      rule: 'longInactivity',
      reason: `Still fresh (${Math.round(days)}d)`,
    };
  }
  const cappedConfidence = Math.min(state.confidence, RUSTY_CONFIDENCE_CEILING);
  return {
    next: {
      ...state,
      confidence: clampUnit(cappedConfidence),
      recencyDays: Number.isFinite(days) ? Math.round(days) : Infinity,
    },
    rule: 'longInactivity',
    reason: `Rusty: no evidence for ${Math.round(days)}d, confidence capped at ${RUSTY_CONFIDENCE_CEILING}, historical proficiency preserved`,
  };
}

// -------- derived --------

/**
 * Level bands per blueprint §6.1: proficiency + evidence-count both matter.
 * Fresh evidence multiplies proficiency into a 1..100 level, but a single 100-proficiency
 * point does not equal ten evidence rows at 50.
 */
export function level(state: SkillState): number {
  if (state.evidenceCount === 0) return 1;
  // log2(evidenceCount+1) caps the multiplier so 1 vs 4 vs 16 rows differ but don't runaway.
  const evidenceFactor = Math.min(1.5, 0.6 + 0.15 * Math.log2(state.evidenceCount + 1));
  const raw = state.proficiency * evidenceFactor * (0.5 + 0.5 * state.confidence);
  return Math.max(1, Math.min(100, Math.round(raw)));
}

/**
 * Gap toward a role's threshold. Positive = deficit, zero = meets bar, negative = surplus.
 * Uses derived level so evidence count + confidence are baked in.
 */
export function gap(state: SkillState, roleThreshold: number): number {
  return roleThreshold - level(state);
}

// -------- aggregator --------

const RULE_BY_SIGNAL: Record<EvidenceSignal, (s: SkillState, e: Evidence) => RuleResult> = {
  'correct-independent': correctIndependent,
  'correct-hinted': correctHinted,
  'partial-correct': partialCorrect,
  'incorrect-with-correction': incorrectWithCorrection,
  'repeated-failure': repeatedFailure,
  'sustained-application': sustainedApplication,
  presence,
};

export interface AggregateResult {
  state: SkillState;
  events: Array<{ rule: string; reason: string; observedAt: Date }>;
}

/**
 * Fold evidence in chronological order, apply matching rule per event, then apply
 * longInactivity based on the latest observedAt. Deterministic and pure.
 */
export function aggregate(
  evidence: Evidence[],
  now: Date = new Date(),
  seed: SkillState = EMPTY_STATE,
): AggregateResult {
  const sorted = [...evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  let state = seed;
  const events: AggregateResult['events'] = [];
  for (const ev of sorted) {
    const res = RULE_BY_SIGNAL[ev.signal](state, ev);
    state = res.next;
    events.push({ rule: res.rule, reason: res.reason, observedAt: ev.observedAt });
  }
  const latest = sorted.length > 0 ? sorted[sorted.length - 1]!.observedAt : null;
  const rusty = longInactivity(state, now, latest);
  state = rusty.next;
  events.push({ rule: rusty.rule, reason: rusty.reason, observedAt: now });
  return { state, events };
}

// -------- helpers --------

function weight(ev: Evidence): number {
  const base = EVIDENCE_WEIGHT[ev.kind];
  const w = ev.weightHint ?? base;
  return clampUnit(w);
}

function bump(state: SkillState, _ev: Evidence, patch: Partial<SkillState>): SkillState {
  return {
    proficiency: patch.proficiency ?? state.proficiency,
    confidence: patch.confidence ?? state.confidence,
    recencyDays: 0, // we just saw evidence
    historicalDemonstrated: patch.historicalDemonstrated ?? state.historicalDemonstrated,
    evidenceCount: state.evidenceCount + 1,
  };
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampProficiency(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}
