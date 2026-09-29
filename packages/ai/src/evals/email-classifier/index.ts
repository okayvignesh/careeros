// E.5 eval runner. Two modes:
//   heuristic-only (default): every fixture is graded against the pure
//     heuristic classifier. Zero LLM cost. Runs in CI on every push.
//   live LLM (opt-in): caller passes an AIProvider and each miss runs
//     through the LLM stage; we grade against the fixture's expected
//     class. Costs real tokens.
//
// The returned SuiteResult mirrors the skill-extract eval shape so a
// downstream reporter can consume both.

import {
  classifyEmailHeuristic,
  type EmailClass,
  type EmailClassification,
} from '@careeros/shared';
import type { AIProvider } from '../../provider';
import { classifyEmail } from '../../classifiers/email-classifier';
import { EMAIL_FIXTURES, type EmailFixture } from './fixtures';

export interface FixtureRun {
  readonly fixture: EmailFixture;
  readonly output: EmailClassification & { method: string };
  readonly passed: boolean;
  readonly reason?: string;
}

export interface SuiteResult {
  readonly results: FixtureRun[];
  readonly perClass: Record<EmailClass, { total: number; passed: number }>;
  readonly overall: { total: number; passed: number };
}

export async function runEmailClassifierEvals(opts?: {
  provider?: AIProvider;
}): Promise<SuiteResult> {
  const results: FixtureRun[] = [];
  for (const f of EMAIL_FIXTURES) {
    const output = opts?.provider
      ? await classifyEmail({
          from: f.from,
          subject: f.subject,
          snippet: f.snippet,
          provider: opts.provider,
        })
      : gradeHeuristicOnly(f);
    const { passed, reason } = grade(f, output);
    results.push({ fixture: f, output, passed, ...(reason !== undefined ? { reason } : {}) });
  }
  return summarise(results);
}

function gradeHeuristicOnly(f: EmailFixture): EmailClassification & { method: string } {
  const h = classifyEmailHeuristic({ from: f.from, subject: f.subject, snippet: f.snippet });
  if (h) return { ...h, method: 'heuristic' };
  return { class: 'other', confidence: 0.3, method: 'fallback' };
}

function grade(
  fixture: EmailFixture,
  output: EmailClassification,
): { passed: boolean; reason?: string } {
  if (output.class !== fixture.expectedClass) {
    return {
      passed: false,
      reason: `class mismatch: got ${output.class}, expected ${fixture.expectedClass}`,
    };
  }
  if (output.confidence < fixture.expectedConfidenceMin) {
    return {
      passed: false,
      reason: `confidence ${output.confidence} < ${fixture.expectedConfidenceMin}`,
    };
  }
  return { passed: true };
}

function summarise(results: FixtureRun[]): SuiteResult {
  const perClass = {} as Record<EmailClass, { total: number; passed: number }>;
  let passed = 0;
  for (const r of results) {
    const cls = r.fixture.expectedClass;
    if (!perClass[cls]) perClass[cls] = { total: 0, passed: 0 };
    perClass[cls].total += 1;
    if (r.passed) {
      perClass[cls].passed += 1;
      passed += 1;
    }
  }
  return {
    results,
    perClass,
    overall: { total: results.length, passed },
  };
}

export { EMAIL_FIXTURES, type EmailFixture } from './fixtures';
