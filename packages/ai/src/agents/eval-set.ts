// C-P2.8c: agent eval helper. Thin bridge from an AgentEval[] to the C-P1.4
// eval runner. Reuses runEval + toJunitXml + toJsonSummary so agent suites
// emit the same artifact shape the nightly-evals workflow already uploads.
//
// Ponytail: no new eval framework. AgentEval carries id + input + expected +
// judge; caller owns scoring maths (F1, band, etc). Runner drives the loop
// and writes the JUnit + JSON summaries.
import type { AgentAuditEvent, AgentRunContext } from './orchestrator';
import { runAgent, setAgentAuditHook } from './orchestrator';
import { runEval, toJsonSummary, toJunitXml } from '../evals/runner';
import type { EvalReport, EvalScore, EvalSuite } from '../evals/types';

export interface AgentEvalScore {
  /** Fraction in [0, 1]; pass gate defined by the judge, not the runner. */
  score: number;
  pass: boolean;
  detail?: string;
}

/**
 * Judge signature: actual model output + expected → pass/fail + score.
 * Callers own the scoring maths so an F1 gate lives with the caller.
 */
export type AgentEvalJudge<Output, Expected> = (
  actual: Output,
  expected: Expected,
) => AgentEvalScore;

export interface AgentEval<Input, Output, Expected> {
  id: string;
  input: Input;
  expected: Expected;
  judge: AgentEvalJudge<Output, Expected>;
}

export interface AgentEvalArtifacts {
  report: EvalReport;
  junitXml: string;
  jsonSummary: ReturnType<typeof toJsonSummary>;
  audit: AgentAuditEvent[];
}

// Internal expected shape passed to the underlying EvalSuite: the caller's
// expected plus a pointer back to the AgentEval so the score closure can
// invoke the right judge without a side-channel map.
interface WrappedExpected<Output, Expected> {
  expected: Expected;
  judge: AgentEvalJudge<Output, Expected>;
  id: string;
}

/**
 * Run a batch of AgentEvals against a registered agent. Audit events are
 * captured for the run so callers can assert per-case audit shape without
 * touching module state.
 *
 * Returned report + JUnit XML + JSON summary match the shape the
 * nightly-evals workflow ingests, so a new agent suite plugs in without CI
 * plumbing changes.
 */
export async function runAgentEvals<Input, Output, Expected>(
  agentId: string,
  evals: AgentEval<Input, Output, Expected>[],
  ctx?: AgentRunContext & { version?: string },
): Promise<AgentEvalArtifacts> {
  const audit: AgentAuditEvent[] = [];
  setAgentAuditHook((e) => audit.push(e));
  try {
    const suite: EvalSuite<Input, WrappedExpected<Output, Expected>> = {
      name: `agent:${agentId}`,
      promptId: agentId,
      promptVersion: ctx?.version ?? 'latest',
      cases: evals.map((e) => ({
        id: e.id,
        input: e.input,
        expected: { expected: e.expected, judge: e.judge, id: e.id },
      })),
      score(actual, wrapped): EvalScore {
        const r = wrapped.judge(actual as Output, wrapped.expected);
        return {
          case: wrapped.id,
          pass: r.pass,
          score: r.score,
          ...(r.detail !== undefined ? { detail: r.detail } : {}),
        };
      },
    };

    const report = await runEval(suite, async (_suite, input) => {
      const run = await runAgent<never, never>(agentId, input, ctx, ctx?.version);
      return run.output;
    });

    return {
      report,
      junitXml: toJunitXml([report]),
      jsonSummary: toJsonSummary([report]),
      audit,
    };
  } finally {
    setAgentAuditHook(null);
  }
}
