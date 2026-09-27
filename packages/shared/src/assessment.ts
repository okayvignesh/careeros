// Assessment engine primitives (blueprint §6 XP + §8 assessment types).
// Pure functions only. All side effects live in apps/api. Slice 1 covers the
// knowledge-question path; other task types plug in as they land.
//
// Level bands live in `./xp.ts` (shared with the P1 dashboard LevelHeader).
// This file only adds XP-per-kind, streaks, and the slice-1 rule-based grader.

import { levelFromXp, xpForLevel, xpToNextLevel } from './xp';

export type TaskKind =
  | 'knowledge'
  | 'coding-easy'
  | 'coding-medium'
  | 'coding-hard'
  | 'debugging'
  | 'build'
  | 'system-design'
  | 'code-review'
  | 'verbal-defense'
  | 'mock-interview'
  | 'boss-battle';

/**
 * Blueprint §6 defaults. Score is expected in [0..1]; XP scales linearly.
 * Rounding is deferred to callers so aggregates can stay in float land.
 */
const XP_BASE: Record<TaskKind, number> = {
  knowledge: 50,
  'coding-easy': 100,
  'coding-medium': 200,
  'coding-hard': 400,
  debugging: 150,
  build: 300,
  'system-design': 250,
  'code-review': 150,
  'verbal-defense': 200,
  'mock-interview': 500,
  'boss-battle': 1000,
};

export function xpFor(kind: TaskKind, score: number): number {
  const clamped = Math.max(0, Math.min(1, score));
  return Math.round(XP_BASE[kind] * clamped);
}

// -------- level bands --------

export interface LevelInfo {
  level: number;
  xpInLevel: number;
  xpToNext: number;
  totalXp: number;
}

/**
 * Wraps the shared level curve (`./xp.ts`) for a single-call summary.
 * Named `xpLevel` (not `level`) to avoid colliding with `knowledge-rules.level(SkillState)`,
 * which computes a per-skill level from evidence weight (very different domain).
 */
export function xpLevel(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));
  const l = levelFromXp(xp);
  // xp.ts convention: xpForLevel(l) = XP needed to REACH level (l+1). L1 starts at 0.
  const prevStart = l === 1 ? 0 : xpForLevel(l);
  return {
    level: l,
    xpInLevel: xp - prevStart,
    xpToNext: xpToNextLevel(xp),
    totalXp: xp,
  };
}

// -------- streaks --------

export interface StreakState {
  currentDays: number;
  longestDays: number;
  lastAttemptDate: Date | null;
  graceRemaining: number;
  graceResetsAt: Date; // first of next month
}

/** Blueprint: 1 attempt/day threshold, 2 grace days per month, >48h gap without grace = reset. */
export function newStreak(now: Date): StreakState {
  return {
    currentDays: 0,
    longestDays: 0,
    lastAttemptDate: null,
    graceRemaining: 2,
    graceResetsAt: startOfNextMonth(now),
  };
}

export function streakTick(state: StreakState, attemptAt: Date): StreakState {
  // Refresh monthly grace pool if we've crossed into a new month.
  const monthlyReset =
    attemptAt >= state.graceResetsAt
      ? { graceRemaining: 2, graceResetsAt: startOfNextMonth(attemptAt) }
      : { graceRemaining: state.graceRemaining, graceResetsAt: state.graceResetsAt };

  if (!state.lastAttemptDate) {
    const currentDays = 1;
    return {
      ...monthlyReset,
      currentDays,
      longestDays: Math.max(state.longestDays, currentDays),
      lastAttemptDate: dayFloor(attemptAt),
    };
  }

  const dayDiff = daysBetween(dayFloor(state.lastAttemptDate), dayFloor(attemptAt));

  if (dayDiff === 0) return { ...state, ...monthlyReset }; // same day; no change to streak.
  if (dayDiff === 1) {
    const currentDays = state.currentDays + 1;
    return {
      ...monthlyReset,
      currentDays,
      longestDays: Math.max(state.longestDays, currentDays),
      lastAttemptDate: dayFloor(attemptAt),
    };
  }
  // Gap. Consume grace before resetting.
  const gapDays = dayDiff - 1;
  if (gapDays <= monthlyReset.graceRemaining) {
    const currentDays = state.currentDays + 1;
    return {
      ...monthlyReset,
      graceRemaining: monthlyReset.graceRemaining - gapDays,
      currentDays,
      longestDays: Math.max(state.longestDays, currentDays),
      lastAttemptDate: dayFloor(attemptAt),
    };
  }
  return {
    ...monthlyReset,
    currentDays: 1,
    longestDays: state.longestDays,
    lastAttemptDate: dayFloor(attemptAt),
  };
}

// -------- knowledge grader (rule-based fallback) --------

// `KnowledgeGrade` shape is now the Zod-inferred schema in `schemas/index.ts`
// so the LLM grader and the rule-based fallback return identical structures.

import type { CodeReviewGrade, DebuggingGrade, KnowledgeGrade, MockInterviewGrade } from './schemas';
export type { CodeReviewGrade, DebuggingGrade, KnowledgeGrade, MockInterviewGrade };

/**
 * String-match against `keyPoints`, one point each; hits ÷ total = score.
 * Fallback path when no provider is configured or the LLM grader fails.
 */
export function gradeKnowledge(answer: string, keyPoints: string[]): KnowledgeGrade {
  const norm = answer.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const kp of keyPoints) {
    if (norm.includes(kp.toLowerCase())) hits.push(kp);
    else misses.push(kp);
  }
  const score = keyPoints.length === 0 ? 0 : hits.length / keyPoints.length;
  const reasoning =
    keyPoints.length === 0
      ? 'No key points on this question; auto-zero. Regenerate before serving again.'
      : `Matched ${hits.length}/${keyPoints.length} key points.`;
  return { score, hits, misses, reasoning };
}

// -------- code-review grader (rule-based fallback) --------

/**
 * Token-overlap grader. For each defect and each finding, compute the overlap
 * coefficient (|A∩B|/min(|A|,|B|)) on lowercased tokens ≥3 chars; a finding
 * "matches" a defect when overlap ≥ `matchThreshold` (default 0.5). Each defect
 * matches at most one finding, and each finding matches at most one defect.
 * Precision + recall are computed from matched pairs; score = F1.
 *
 * Overlap-coefficient (not Jaccard) so a short finding can still match a
 * longer defect description — the reviewer usually writes tighter prose than
 * the answer key.
 *
 * Called when no provider is configured or the LLM grader fails. Sensitive to
 * wording, but good enough as a fallback so users still get a graded attempt.
 */
export function gradeCodeReview(
  findings: string[],
  defects: string[],
  matchThreshold = 0.5,
): CodeReviewGrade {
  const nonEmptyFindings = findings.map((f) => f.trim()).filter((f) => f.length > 0);
  if (defects.length === 0) {
    return {
      score: 0,
      precision: 0,
      recall: 0,
      hits: [],
      misses: [],
      falsePositives: nonEmptyFindings,
      reasoning: 'No defects defined for this task; auto-zero. Regenerate before serving again.',
    };
  }
  if (nonEmptyFindings.length === 0) {
    return {
      score: 0,
      precision: 0,
      recall: 0,
      hits: [],
      misses: [...defects],
      falsePositives: [],
      reasoning: 'No findings submitted.',
    };
  }
  const findingTokens = nonEmptyFindings.map(tokenSet);
  const defectTokens = defects.map(tokenSet);
  const matchedFindings = new Set<number>();
  const matchedDefects = new Set<number>();
  const pairs: Array<{ d: number; f: number; sim: number }> = [];
  for (let di = 0; di < defectTokens.length; di++) {
    for (let fi = 0; fi < findingTokens.length; fi++) {
      const sim = overlapCoefficient(defectTokens[di]!, findingTokens[fi]!);
      if (sim >= matchThreshold) pairs.push({ d: di, f: fi, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  for (const p of pairs) {
    if (matchedDefects.has(p.d) || matchedFindings.has(p.f)) continue;
    matchedDefects.add(p.d);
    matchedFindings.add(p.f);
  }
  const hits = [...matchedDefects].map((i) => defects[i]!);
  const misses = defects.filter((_, i) => !matchedDefects.has(i));
  const falsePositives = nonEmptyFindings.filter((_, i) => !matchedFindings.has(i));
  const precision = matchedFindings.size / nonEmptyFindings.length;
  const recall = matchedDefects.size / defects.length;
  const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    score,
    precision,
    recall,
    hits,
    misses,
    falsePositives,
    reasoning: `Matched ${matchedDefects.size}/${defects.length} defects; ${falsePositives.length} finding(s) unmatched.`,
  };
}

// -------- mock interview grader (rule-based fallback) --------

/**
 * Batched keyPoint-overlap grader across all 3 questions. Runs `gradeKnowledge`
 * per Q against its declared keyPoints, averages. Very coarse — behavioral
 * questions especially don't grade well against keyword lists — but keeps the
 * pipeline moving when no LLM provider is configured.
 */
export function gradeMockInterview(
  answers: string[],
  questions: Array<{ keyPoints: string[] }>,
): MockInterviewGrade {
  if (questions.length !== 3 || answers.length !== 3) {
    return {
      score: 0,
      questions: questions.map((_, i) => ({
        index: i as 0 | 1 | 2,
        score: 0,
        hits: [],
        misses: [],
        notes: 'Malformed input: expected exactly 3 questions and 3 answers.',
      })),
      reasoning: 'Malformed input.',
    };
  }
  const per = questions.map((q, i) => {
    const grade = gradeKnowledge(answers[i] ?? '', q.keyPoints);
    return {
      index: i as 0 | 1 | 2,
      score: grade.score,
      hits: grade.hits,
      misses: grade.misses,
      notes: `Matched ${grade.hits.length}/${q.keyPoints.length} key points.`,
    };
  });
  const score = per.reduce((acc, p) => acc + p.score, 0) / per.length;
  return {
    score,
    questions: per,
    reasoning: `Rule-based fallback: mean of per-question keyPoint match. Overall ${(score * 100).toFixed(0)}%.`,
  };
}

// -------- debugging grader (rule-based fallback) --------

/**
 * Coarse fallback. Compares user's fix against the broken code (to detect
 * whether they actually changed something) and against the hidden rootCause
 * text (to detect whether the change relates to the root cause). Correctness
 * = token overlap between diff and rootCause. Minimality = 1 - churn/size.
 *
 * Sensitive to wording and unable to actually run the code — LLM path is the
 * intended grader; this just keeps the pipeline flowing when no provider is
 * configured so the user still gets a graded attempt.
 */
export function gradeDebugging(
  brokenCode: string,
  userFix: string,
  rootCause: string,
): DebuggingGrade {
  if (userFix.trim().length === 0) {
    return {
      score: 0,
      correctness: 0,
      minimality: 0,
      reasoning: 'No fix submitted.',
    };
  }
  const unchanged = userFix.trim() === brokenCode.trim();
  // Base credit for "actually attempted a change". Rule fallback can't run code,
  // so it can't know if the fix is correct — LLM grader is the real signal.
  let correctness = unchanged ? 0 : 0.5;
  const rootTokens = tokenSet(rootCause);
  const fixTokens = tokenSet(userFix);
  if (!unchanged && rootTokens.size > 0) {
    let overlap = 0;
    for (const t of rootTokens) if (fixTokens.has(t)) overlap++;
    correctness = Math.min(1, 0.5 + (0.5 * overlap) / rootTokens.size);
  }

  const brokenSize = Math.max(1, brokenCode.length);
  const diffSize = Math.abs(userFix.length - brokenCode.length);
  const minimality = Math.max(0, 1 - diffSize / brokenSize);

  const score = (correctness + minimality) / 2;
  return {
    score,
    correctness,
    minimality,
    reasoning: unchanged
      ? 'Fix is identical to the broken code; no change attempted.'
      : `Rule-based fallback (LLM grader recommended): correctness ${(correctness * 100).toFixed(0)}%, minimality ${(minimality * 100).toFixed(0)}%.`,
  };
}

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

// -------- remediation detector --------

/**
 * Repeated-failure detector. Given a user's recent attempts on ONE skill
 * (chronological order, newest OR oldest — order-independent), decide
 * whether the aggregator should open a remediation task.
 *
 * Default rule: 3+ attempts in the last N days where every one scored below
 * `failThreshold` (default 0.5). Windowed so an old cluster of fails a year ago
 * doesn't keep re-triggering; consecutive so a mixed record of pass/fail doesn't.
 */
export interface RemediationInput {
  score: number;
  createdAt: Date;
}

export interface RemediationRule {
  minFails: number; // consecutive fails required (default 3)
  windowDays: number; // only look at attempts inside this window (default 14)
  failThreshold: number; // score strictly below this counts as a fail (default 0.5)
}

export const DEFAULT_REMEDIATION_RULE: RemediationRule = {
  minFails: 3,
  windowDays: 14,
  failThreshold: 0.5,
};

export interface RemediationDecision {
  shouldOpen: boolean;
  consecutiveFails: number;
  reason: string;
  triggeringAttempts: RemediationInput[];
}

export function shouldRemediate(
  attempts: RemediationInput[],
  now: Date = new Date(),
  rule: RemediationRule = DEFAULT_REMEDIATION_RULE,
): RemediationDecision {
  const cutoff = new Date(now.getTime() - rule.windowDays * 86_400_000);
  const recent = attempts
    .filter((a) => a.createdAt >= cutoff)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first
  const streak: RemediationInput[] = [];
  for (const a of recent) {
    if (a.score < rule.failThreshold) streak.push(a);
    else break; // streak broken by a pass; don't count older fails
  }
  const shouldOpen = streak.length >= rule.minFails;
  return {
    shouldOpen,
    consecutiveFails: streak.length,
    reason: shouldOpen
      ? `Failed ${streak.length} times in a row within ${rule.windowDays}d (scores < ${rule.failThreshold})`
      : `Only ${streak.length} consecutive recent fail(s); threshold ${rule.minFails}`,
    triggeringAttempts: streak,
  };
}

// -------- helpers --------

function dayFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
