// C-P4.7a: shared fact-check gate.
//
// Extracted from apps/api/.../resume-variants + cover-letters after two live
// implementations converged on the same shape (three would let extraction
// pay for itself, but the third caller — dossier — needs the exact same
// verdict-map / fail-open contract, so extracting at N=2 is honest). Every
// call site keeps its own pre-wrap (which chunks are "claim-bearing" varies
// per surface) and its own drop-audit shape (bullet vs paragraph vs claim).
// This module only owns the LLM round-trip + verdict decoding.
//
// Contract in one line: `runFactCheck` runs ONE LLM call over a flat list of
// {index, text, factRefs} items, returns `Map<index, {supported, reason}>` or
// `null` if the auditor blew up. Callers decide what dropping means.
import type { FactCheckResult } from '@careeros/shared';
import type { AIProvider } from '../provider';
// Import from the prompts barrel (not `./registry`) so the side-effect imports
// there register every prompt — otherwise callers must remember to import
// `../prompts` first, which is the exact footgun the barrel exists to prevent.
import { renderPrompt } from '../prompts';

// -----------------------------------------------------------------------------
// Public shapes
// -----------------------------------------------------------------------------

/**
 * A cited fact + a short summary of its content, ready to be inlined under a
 * claim. The service chooses how to derive `summary` from its domain type
 * (resume fact JSON, market-brief job row, dossier fact record, etc.).
 */
export interface CitedFact {
  id: string;
  /** e.g. `employment`, `education`, `job-description`, `company-page`. */
  kind: string;
  /** One-line summary; caps to ~300 chars are the caller's job. */
  summary: string;
}

/**
 * One item the fact-check should audit. `index` is the flat position the
 * verdict comes back keyed by — the caller decides whether that maps to a
 * bullet, a paragraph, or a synthesised claim.
 */
export interface Claim {
  index: number;
  text: string;
  cited: CitedFact[];
}

/**
 * Verdict per claim. Missing entries in the returned Map mean "no verdict";
 * every real caller treats that as DROP (trust-critical default: silent
 * omission by the LLM must not launder into a false-green audit).
 */
export interface Verdict {
  supported: boolean;
  reason: string;
}

/**
 * `runFactCheck` result. `null` verdicts = auditor call itself failed. The
 * caller marks the artifact `unchecked` in that case (fail-open with warning
 * over dropping the whole draft — the tradeoff was chosen when the resume
 * variant slice shipped and is preserved here).
 */
export type FactCheckOutcome =
  | { ok: true; verdicts: Map<number, Verdict> }
  | { ok: false; reason: string };

// -----------------------------------------------------------------------------
// Renderer + gate
// -----------------------------------------------------------------------------

/**
 * Build the `bullets` template variable for the `resume-bullet-fact-check`
 * prompt. Extracted so callers with different domain item shapes still emit
 * an identical prompt body — that shared prompt-body is why the two original
 * implementations were converging in the first place.
 */
export function renderClaimsForPrompt(claims: Claim[]): string {
  return claims
    .map((c) => {
      const cited = c.cited
        .map((f) => `    - id=${f.id} kind=${f.kind} ${f.summary}`)
        .join('\n');
      return `[${c.index}] ${c.text}\n  cites:\n${cited}`;
    })
    .join('\n\n');
}

export interface RunFactCheckOptions {
  provider: Pick<AIProvider, 'chatStructured'>;
  claims: Claim[];
  /**
   * Concurrency wrapper. In production this is `UsageService.runWithUserLimit`
   * which enforces the per-user LLM burst cap (A-M9). Tests pass an identity
   * wrapper. Kept as a parameter rather than reached-into to keep this module
   * off the apps/api dependency graph.
   */
  runWithUserLimit?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Prompt id override. Default `resume-bullet-fact-check` (only one shipping). */
  promptId?: string;
}

/**
 * One LLM call, one verdict map. Never throws for the "auditor said something
 * weird" case — returns `{ ok: false, reason }` so the caller can mark
 * `unchecked` and keep the draft. Only throws on programmer error (an unknown
 * prompt id).
 */
export async function runFactCheck(
  opts: RunFactCheckOptions,
): Promise<FactCheckOutcome> {
  const { provider, claims } = opts;
  // Empty input = trivially "all-passed" and nothing to score. Bail before
  // spending a token; matches the prior resume-variants short-circuit.
  if (claims.length === 0) {
    return { ok: true, verdicts: new Map() };
  }

  const rendered = renderPrompt(opts.promptId ?? 'resume-bullet-fact-check', {
    bullets: renderClaimsForPrompt(claims),
  });
  const wrap = opts.runWithUserLimit ?? (async <T>(fn: () => Promise<T>) => fn());

  try {
    const result = (await wrap(() =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0,
      }),
    )) as FactCheckResult;
    const verdicts = new Map<number, Verdict>();
    for (const r of result.results) {
      verdicts.set(r.bulletIndex, { supported: r.supported, reason: r.reason });
    }
    return { ok: true, verdicts };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
