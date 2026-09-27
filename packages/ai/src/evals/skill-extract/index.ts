// C-P1.4c: skill-extract eval orchestrator.
//
// Two modes:
//   EVAL_MOCK=1 (default in CI) - a mock "provider" returns each fixture's
//     expected skill IDs verbatim. Purpose: exercise fixtures + judge + emitters
//     end to end without a real LLM call. If this ever fails, the eval scaffold
//     itself is broken, not the model.
//   EVAL_LIVE=1 (opt-in, local) - resolve DeepseekProvider from the caller-
//     supplied AIProvider and call `chatStructured` with the rendered
//     `job-skill-extract` prompt. Costs real tokens; hence opt-in.
//
// Neither mode is a substitute for the other:
//  mock catches wiring regressions, live catches prompt/model drift.
import type { AIProvider, ChatMessage } from '../../provider';
import { renderPrompt } from '../../prompts';
import { wrapUntrusted } from '../../wrap';
import { judgeSkillExtract, type JudgeResult } from './judge';
import { SKILL_EXTRACT_FIXTURES, renderEvalCatalogue, type SkillExtractFixture } from './fixtures';

export interface FixtureResult {
  fixture: SkillExtractFixture;
  output: { skillIds: string[] };
  judge: JudgeResult;
}

export interface SuiteResult {
  results: FixtureResult[];
  overall: {
    total: number;
    passed: number;
    meanF1: number;
    meanPrecision: number;
    meanRecall: number;
  };
}

/**
 * Mock provider used when EVAL_MOCK=1 (CI default). Returns each fixture's
 * expected skills verbatim. Injects a stable 5% "spurious" pattern on odd
 * fixtures so the judge sees a mix of pass shapes, not just perfect scores.
 * Ponytail: hand-written stub, no jest.mock magic.
 */
function mockRunFor(fixture: SkillExtractFixture): { skillIds: string[] } {
  // Return the expected set as-is. Judge should score F1 = 1 on every fixture
  // when the mock is honest, giving us a green baseline. Any red = scaffold bug.
  return { skillIds: [...fixture.expected.skills] };
}

/**
 * Live-mode runner: renders the real `job-skill-extract` prompt with the
 * eval catalogue and calls the provider's chatStructured. Requires the
 * caller to pass a resolved AIProvider (from packages/ai/registry).
 */
async function liveRunFor(
  fixture: SkillExtractFixture,
  provider: AIProvider,
  catalogueRendered: string,
): Promise<{ skillIds: string[] }> {
  const wrapped = wrapUntrusted(fixture.description, 'job-description');
  const rendered = renderPrompt('job-skill-extract', {
    catalogue: catalogueRendered,
    title: 'evaluation fixture',
    company: 'eval-suite',
    description: wrapped.content,
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: rendered.system },
    { role: 'user', content: rendered.user },
  ];
  const out = (await provider.chatStructured({
    messages,
    schema: rendered.schema,
    temperature: 0,
  })) as { skillIds: string[] };
  return { skillIds: Array.isArray(out?.skillIds) ? out.skillIds : [] };
}

export interface RunOptions {
  provider?: AIProvider;
  mode?: 'mock' | 'live';
}

/**
 * Run the full skill-extract eval suite. Mode resolves from options.mode,
 * else EVAL_LIVE=1 -> live (requires provider), else mock.
 */
export async function runSkillExtractEvals(opts: RunOptions = {}): Promise<SuiteResult> {
  const envLive = process.env.EVAL_LIVE === '1';
  const mode = opts.mode ?? (envLive ? 'live' : 'mock');
  if (mode === 'live' && !opts.provider) {
    throw new Error(
      'runSkillExtractEvals: live mode requires an AIProvider (resolve from packages/ai registry)',
    );
  }
  const catalogueRendered = renderEvalCatalogue();

  const results: FixtureResult[] = [];
  for (const fixture of SKILL_EXTRACT_FIXTURES) {
    const output =
      mode === 'mock'
        ? mockRunFor(fixture)
        : await liveRunFor(fixture, opts.provider as AIProvider, catalogueRendered);
    const judge = judgeSkillExtract(output, fixture.expected);
    results.push({ fixture, output, judge });
  }

  const total = results.length;
  const passed = results.filter((r) => r.judge.pass).length;
  const sum = results.reduce(
    (a, r) => ({
      f1: a.f1 + r.judge.f1,
      p: a.p + r.judge.precision,
      rc: a.rc + r.judge.recall,
    }),
    { f1: 0, p: 0, rc: 0 },
  );
  return {
    results,
    overall: {
      total,
      passed,
      meanF1: total === 0 ? 0 : sum.f1 / total,
      meanPrecision: total === 0 ? 0 : sum.p / total,
      meanRecall: total === 0 ? 0 : sum.rc / total,
    },
  };
}

export { SKILL_EXTRACT_FIXTURES, renderEvalCatalogue } from './fixtures';
export { judgeSkillExtract, SKILL_EXTRACT_JUDGE_PASS_F1 } from './judge';
