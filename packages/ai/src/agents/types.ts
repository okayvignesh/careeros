// C-P2.8a: agent registry types. An AgentDef is a declarative, versioned
// binding of (systemPrompt, input schema, output schema, provider policy) that
// the orchestrator can resolve, run, and audit uniformly. Distinct from the
// prompt catalog (packages/ai/src/prompts/catalog) because an agent is the
// full call unit (prompt + provider policy + tools + IO contract), not just
// the string template.
//
// Ponytail: no per-agent class, no factory. A registered agent is data; the
// orchestrator does the work. Splits cleanly along the same seam as
// ProviderRegistry vs. DeepSeekProvider.
import type { ZodTypeAny, z } from 'zod';
import type { RenderedPrompt } from '../prompts/types';

/**
 * Tool spec surfaced to an agent. `invoke` runs the tool with parsed args and
 * returns a JSON-serialisable result. The orchestrator does not itself execute
 * tools yet (no provider on the AIProvider surface exposes tool-use in a
 * uniform way); the field exists so the shape is stable for the future call
 * site and so agent registrations declare their capability surface up front.
 */
export interface ToolSpec<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  argsSchema: ZodTypeAny;
  invoke: (args: Args) => Promise<Result>;
}

/**
 * A reference to a prompt in the runtime PromptDef registry (packages/ai/src/
 * prompts/registry.ts). When systemPrompt is a PromptRef, the orchestrator
 * calls renderPrompt(id, vars) at run time and uses `system` from the
 * RenderedPrompt as the system message; the `user` field is discarded because
 * the agent's own input schema drives the user message shape. Cleaner than
 * duplicating prompt text inside AgentDef.
 */
export interface PromptRef {
  kind: 'prompt-ref';
  id: string;
  version?: string;
  /** Variables passed to renderPrompt. Rendered once per run. */
  vars?: Record<string, string>;
}

export interface AgentDef<
  Input = unknown,
  Output = unknown,
  I extends ZodTypeAny = ZodTypeAny,
  O extends ZodTypeAny = ZodTypeAny,
> {
  /** Stable slug used in audit rows. */
  id: string;
  /** Semver. Bump on any behavioural change (prompt swap, schema shift). */
  version: string;
  description: string;
  /** Static system prompt string OR a reference into the prompt registry. */
  systemPrompt: string | PromptRef;
  inputSchema: I;
  outputSchema: O;
  /** Per-call maxTokens override. Provider default (4096) applies otherwise. */
  maxTokens?: number;
  /** Sampling temperature. Defaults to 0 in the orchestrator. */
  temperature?: number;
  /**
   * Provider name (matches ProviderRegistry.register key). When omitted the
   * orchestrator's default provider is used.
   */
  provider?: string;
  /**
   * Declared tools. Wired into the agent registration surface today; direct
   * tool-call dispatch through provider.chatStructured lands when the AIProvider
   * contract grows tool-use. Registrations still declare so the audit surface
   * lists what an agent can touch.
   */
  tools?: ToolSpec[];
  // Phantom generics so TS carries the typed Input/Output through resolve().
  __in?: Input;
  __out?: Output;
}

/** Shorthand: the input type of an AgentDef. */
export type AgentInput<A> = A extends AgentDef<infer I, unknown> ? I : never;
/** Shorthand: the output type of an AgentDef. */
export type AgentOutput<A> = A extends AgentDef<unknown, infer O> ? O : never;

/** One completed agent run. Returned from orchestrator.runAgent. */
export interface AgentRun<Output = unknown> {
  output: Output;
  tokens: {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  };
  latencyMs: number;
  /** Hash-of-prompt tag when systemPrompt is a PromptRef; else `${id}@${version}`. */
  promptVersion: string;
  provider: string;
}

/** What AgentRegistry.list emits per registered agent. */
export interface AgentInfo {
  id: string;
  version: string;
  description: string;
  provider?: string;
  tools: string[];
}

/**
 * Shared shape used across the whole barrel. Consumers rarely need it, but
 * exporting keeps advanced callers from re-declaring z.output<...> boilerplate.
 */
export type InferAgentOutput<A extends AgentDef<unknown, unknown, ZodTypeAny, ZodTypeAny>> =
  A extends AgentDef<unknown, unknown, ZodTypeAny, infer O> ? z.output<O> : never;

/**
 * The shape the orchestrator passes to a rendered prompt. Kept here (not
 * re-exported from prompts/*) so agents.ts consumers only import from one
 * package region.
 */
export type { RenderedPrompt };
