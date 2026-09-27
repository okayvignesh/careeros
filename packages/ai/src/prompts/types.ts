// Prompt registry types. Every LLM call has to reference a prompt from the registry
// so we can hash, version, and audit it. Ad-hoc string templates in application code
// are banned (an ESLint rule will land with slice 7 to enforce).
import type { z, ZodTypeAny } from 'zod';

export interface PromptExample<S extends ZodTypeAny = ZodTypeAny> {
  label: string;
  input: Record<string, string>;
  expected: z.infer<S>;
}

export interface PromptDef<S extends ZodTypeAny = ZodTypeAny> {
  /** Stable slug used as the call kind in llm_calls + audit rows. */
  id: string;
  /** Semver. Bump on any prompt change so audits can see which text was live. */
  version: string;
  /** System prompt. `UNTRUSTED_SYSTEM_CLAUSE` should be interpolated here for any prompt
      that concatenates wrapped content. */
  system: string;
  /** User message template. `{{name}}` placeholders get filled by `renderPrompt`. */
  userTemplate: string;
  /** Zod schema the model must satisfy. Passed to chatStructured on the provider. */
  schema: S;
  /** Optional few-shot examples. Not sent to the model today; used by evals in slice 7. */
  examples?: PromptExample<S>[];
}

export interface RenderedPrompt<S extends ZodTypeAny = ZodTypeAny> {
  id: string;
  version: string;
  hash: string; // sha256 of {id, version, system, userTemplate}; never depends on input variables
  system: string;
  user: string;
  schema: S;
}
