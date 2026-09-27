// C-P4.7e: fact-check gate eval orchestrator.
//
// EVAL_MOCK (default): mock provider returns the fixture's expected verdict
//   pattern verbatim. Confirms fixtures + judge + gate wiring is intact.
//   Any red = scaffold bug, not model drift.
// EVAL_LIVE=1: opt-in, resolves an AIProvider (caller-supplied) and calls
//   the real `resume-bullet-fact-check` prompt against each fixture.
//   Costs real tokens; skipped when no provider registered.
//
// Runs `runFactCheck` (the actual gate module) for both modes so the eval
// exercises the same code path production uses.
import type { FactCheckResult } from '@careeros/shared';
import type { AIProvider } from '../../provider';
import { runFactCheck, type Claim } from '../../grounded/gate';
import { judgeFactCheck, type JudgeResult } from './judge';
import { FACT_CHECK_FIXTURES, type FactCheckFixture } from './fixtures';

export interface FactCheckFixtureResult {
  fixture: FactCheckFixture;
  judge: JudgeResult;
  verdictCount: number;
}

export interface FactCheckSuiteResult {
  results: FactCheckFixtureResult[];
  overall: {
    total: number;
    passed: number;
    meanF1: number;
    meanPrecision: number;
    meanRecall: number;
    meanHallucinationRate: number;
  };
}

/**
 * Mock provider: returns a FactCheckResult that marks exactly the fixture's
 * `supportedIndices` as supported=true. Every other claim index is OMITTED
 * from the result list — that's how `missing-citation` fixtures exercise
 * the "no verdict = drop" default without a separate mock branch.
 */
function mockProviderFor(fixture: FactCheckFixture): {
  chatStructured: (args: unknown) => Promise<FactCheckResult>;
} {
  return {
    chatStructured: async (): Promise<FactCheckResult> => {
      const supported = new Set(fixture.expected.supportedIndices);
      // For mixed fixtures (some supported, some not), emit an explicit
      // supported=false for the non-supported indices so the drop reason
      // is a real verdict, not "no verdict returned". Missing-citation
      // fixtures OMIT indices entirely so the drop is a missing verdict.
      const isMissingCitation = fixture.category === 'missing-citation';
      const results: FactCheckResult['results'] = [];
      for (let i = 0; i < fixture.claims.length; i++) {
        if (supported.has(i)) {
          results.push({ bulletIndex: i, supported: true, reason: 'mock: supported' });
        } else if (!isMissingCitation) {
          results.push({ bulletIndex: i, supported: false, reason: 'mock: not supported' });
        }
        // else: omit -> exercises the "no verdict = drop" default.
      }
      return { results };
    },
  };
}

function claimsFromFixture(fixture: FactCheckFixture): Claim[] {
  const factById = new Map(fixture.factBase.map((f) => [f.id, f]));
  return fixture.claims.map((c, i) => ({
    index: i,
    text: c.text,
    cited: c.factRefs.map((id) => {
      const f = factById.get(id);
      return f
        ? { id: f.id, kind: f.kind, summary: f.summary }
        : { id, kind: 'missing', summary: '(MISSING)' };
    }),
  }));
}

export interface RunOptions {
  mode?: 'mock' | 'live';
  provider?: AIProvider;
}

export async function runFactCheckEvals(
  opts: RunOptions = {},
): Promise<FactCheckSuiteResult> {
  const envLive = process.env.EVAL_LIVE === '1';
  const mode = opts.mode ?? (envLive ? 'live' : 'mock');
  if (mode === 'live' && !opts.provider) {
    throw new Error(
      'runFactCheckEvals: live mode requires an AIProvider (resolve from packages/ai registry)',
    );
  }

  const results: FactCheckFixtureResult[] = [];
  for (const fixture of FACT_CHECK_FIXTURES) {
    const provider = mode === 'mock' ? mockProviderFor(fixture) : (opts.provider as AIProvider);
    const claims = claimsFromFixture(fixture);
    const outcome = await runFactCheck({ provider, claims });
    const verdicts = outcome.ok ? outcome.verdicts : new Map();
    const judge = judgeFactCheck(
      { verdicts, totalClaims: fixture.claims.length },
      fixture,
    );
    results.push({ fixture, judge, verdictCount: verdicts.size });
  }

  const total = results.length;
  const passed = results.filter((r) => r.judge.pass).length;
  const sum = results.reduce(
    (a, r) => ({
      f1: a.f1 + r.judge.f1,
      p: a.p + r.judge.precision,
      rc: a.rc + r.judge.recall,
      halluc: a.halluc + r.judge.hallucinationRate,
    }),
    { f1: 0, p: 0, rc: 0, halluc: 0 },
  );
  return {
    results,
    overall: {
      total,
      passed,
      meanF1: total === 0 ? 0 : sum.f1 / total,
      meanPrecision: total === 0 ? 0 : sum.p / total,
      meanRecall: total === 0 ? 0 : sum.rc / total,
      meanHallucinationRate: total === 0 ? 0 : sum.halluc / total,
    },
  };
}

export { FACT_CHECK_FIXTURES, type FactCheckFixture } from './fixtures';
export {
  judgeFactCheck,
  FACT_CHECK_JUDGE_PASS_F1,
  FACT_CHECK_JUDGE_DRIFT_F1,
  type JudgeResult,
} from './judge';
