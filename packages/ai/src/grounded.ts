// Grounded-generation wrapper. Callers pass a list of `facts` (raw source strings) +
// a registered prompt id + template vars. The wrapper:
//   1. Wraps every fact with wrapUntrusted (source-tagged, hashed, sanitised)
//   2. Renders the prompt with the wrapped facts inlined
//   3. Calls provider.chatStructured() with the prompt's schema
//   4. Runs the hallucination heuristic on the output
//   5. Emits a report via the optional hook (persisted by the api layer)
//
// The wrapper does NOT prevent hallucinations at the LLM level; it detects them
// post-hoc so the eval loop can track drift over time. Slice 5c will pair this with
// a stricter schema check (evidence_refs must ∈ input IDs) for callers that opt in.
import type { z, ZodTypeAny } from 'zod';
import { wrapUntrusted, type UntrustedSourceKind } from './wrap';
import { renderPrompt } from './prompts/registry';
import { findHallucinations, type HallucinationReport } from './hallucination';
import type { AIProvider } from './provider';

export interface GroundedFact {
  /** Stable identifier, e.g. `emp-3`, `repo-42`, `resume-line-7`. Included in the wrap tag. */
  id: string;
  /** Raw source string. Wrapped verbatim, never mixed with instructions. */
  content: string;
  /** Origin type. Drives sensitivity + audit routing. */
  sourceKind: UntrustedSourceKind;
}

export interface GroundedResult<T> {
  output: T;
  hallucinations: HallucinationReport;
  prompt: {
    id: string;
    version: string;
    hash: string;
  };
}

export type HallucinationHook = (report: HallucinationReport, meta: {
  promptId: string;
  promptVersion: string;
  promptHash: string;
}) => void | Promise<void>;

/**
 * Run a registered prompt with grounded facts. Every fact is wrapped, the prompt
 * is rendered from the registry (never inline), the result is schema-validated,
 * and hallucination-suspect fragments are extracted.
 *
 * `factsVar` is the name of the template placeholder that receives the concatenated
 * wrapped facts. Defaults to `{{facts}}`.
 */
export async function generateGrounded<S extends ZodTypeAny>({
  provider,
  promptId,
  facts,
  vars,
  factsVar = 'facts',
  temperature = 0,
  onHallucination,
}: {
  provider: Pick<AIProvider, 'chatStructured'>;
  promptId: string;
  facts: GroundedFact[];
  vars?: Record<string, string>;
  factsVar?: string;
  temperature?: number;
  onHallucination?: HallucinationHook;
}): Promise<GroundedResult<z.output<S>>> {
  const wrappedFacts = facts.map((f) =>
    wrapUntrusted(`[id=${f.id}] ${f.content}`, f.sourceKind),
  );
  const factsBlock = wrappedFacts.map((w) => w.content).join('\n\n');

  const rendered = renderPrompt<S>(promptId, {
    ...(vars ?? {}),
    [factsVar]: factsBlock,
  });

  const output = (await provider.chatStructured({
    messages: [
      { role: 'system', content: rendered.system },
      { role: 'user', content: rendered.user },
    ],
    schema: rendered.schema,
    temperature,
  })) as z.output<S>;

  // Feed the raw fact content (not the wrapped form) so the heuristic doesn't
  // false-positive on the source tag we ourselves added.
  const hallucinations = findHallucinations(
    output,
    facts.map((f) => f.content),
  );

  if (onHallucination && hallucinations.suspects.length > 0) {
    // Fire-and-forget: never block the caller on audit persistence.
    Promise.resolve()
      .then(() => onHallucination(hallucinations, {
        promptId: rendered.id,
        promptVersion: rendered.version,
        promptHash: rendered.hash,
      }))
      .catch(() => {
        /* swallow */
      });
  }

  return {
    output,
    hallucinations,
    prompt: {
      id: rendered.id,
      version: rendered.version,
      hash: rendered.hash,
    },
  };
}
