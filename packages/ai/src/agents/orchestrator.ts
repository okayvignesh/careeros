// C-P2.8b: agent orchestrator. Single entry point runAgent(id, input, ctx?)
// takes the messy parts every call site had to hand-roll — resolve the agent,
// wrap untrusted strings, validate input, resolve the provider, render the
// system prompt, call chatStructured, emit the audit event — and centralises
// them.
//
// The output-invalidation retry lives inside DeepSeekProvider.chatStructured
// (A-H5). We do not re-implement it here; a provider that grows a different
// retry policy would still work through this orchestrator unchanged.
//
// Ponytail: no state, no class. One function + one injectable audit hook.
// Providers + agents come in through the ctx so tests hand in fakes without
// module-mocking. Emits `security.audit.agent_run` even on failure so a
// silently-failing agent still leaves a trail.
import type { ZodTypeAny, z } from 'zod';
import type { AIProvider, ChatMessage } from '../provider';
import type { ProviderRegistry } from '../registry';
import type { AgentRegistry } from './registry';
import { agentRegistry as defaultAgentRegistry } from './registry';
import { wrapUntrusted, type UntrustedSourceKind } from '../wrap';
import { renderPrompt } from '../prompts/registry';
import type { AgentDef, AgentRun, PromptRef } from './types';

/** Audit event shape emitted for every run (successful or not). */
export interface AgentAuditEvent {
  code: 'security.audit.agent_run';
  agentId: string;
  version: string;
  provider: string;
  latencyMs: number;
  tokens: {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  };
  ok: boolean;
  error?: string;
}

export type AgentAuditHook = (event: AgentAuditEvent) => void;

let auditHook: AgentAuditHook | null = null;

/** Register (or clear) the audit callback. Matches setWrapAuditHook shape. */
export function setAgentAuditHook(hook: AgentAuditHook | null): void {
  auditHook = hook;
}

function audit(evt: AgentAuditEvent): void {
  try {
    auditHook?.(evt);
  } catch {
    /* audit must never throw — matches wrap.ts + injection-scan.ts contract */
  }
}

/**
 * Everything the orchestrator needs at call time. All optional so callers
 * can pass an ad-hoc provider without going through a registry.
 *
 *  - `agents` / `providers`: override the module-level defaults (tests hand
 *    in fake registries, api bootstrap uses the shared ones).
 *  - `provider`: bypass ProviderRegistry entirely (useful when the caller
 *    already has an instance in hand and does not want to name it).
 *  - `defaultProvider`: fallback name when AgentDef.provider is unset.
 *  - `untrustedSource`: how orchestrator tags strings routed through
 *    wrapUntrusted. Defaults to 'user-input'.
 */
export interface AgentRunContext {
  agents?: AgentRegistry;
  providers?: ProviderRegistry;
  provider?: AIProvider;
  defaultProvider?: string;
  untrustedSource?: UntrustedSourceKind;
}

/**
 * Extract the `system` string from an AgentDef.systemPrompt (either the
 * literal string or a rendered lookup into the prompt registry).
 */
function resolveSystem(systemPrompt: string | PromptRef): { system: string; promptVersion: string | null } {
  if (typeof systemPrompt === 'string') {
    return { system: systemPrompt, promptVersion: null };
  }
  const rendered = renderPrompt(systemPrompt.id, systemPrompt.vars ?? {});
  return { system: rendered.system, promptVersion: `${rendered.id}@${rendered.version}` };
}

function resolveProvider(
  agent: AgentDef,
  ctx: AgentRunContext | undefined,
): AIProvider {
  if (ctx?.provider) return ctx.provider;
  const registry = ctx?.providers;
  const name = agent.provider ?? ctx?.defaultProvider;
  if (!registry) {
    throw new Error(
      `agent '${agent.id}@${agent.version}' has no provider in ctx (pass ctx.provider or ctx.providers + defaultProvider)`,
    );
  }
  if (!name) {
    throw new Error(
      `agent '${agent.id}@${agent.version}' has no provider name (set AgentDef.provider or ctx.defaultProvider)`,
    );
  }
  return registry.resolve(name);
}

/**
 * Walk arbitrary input and route every string leaf through wrapUntrusted. The
 * agent's inputSchema still shapes the object; strings just come out
 * pre-wrapped so an inputs-with-embedded-prompt-injection is caught at the
 * boundary rather than inside the prompt template.
 *
 * Objects and arrays recurse; every other primitive passes through unchanged
 * (numbers, booleans, null cannot carry injection). Ponytail: no schema
 * introspection — treating every string uniformly is safer than trying to
 * classify each field's trust level.
 */
function wrapInputStrings(value: unknown, source: UntrustedSourceKind): unknown {
  if (typeof value === 'string') {
    return wrapUntrusted(value, source).content;
  }
  if (Array.isArray(value)) {
    return value.map((v) => wrapInputStrings(v, source));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = wrapInputStrings(v, source);
    }
    return out;
  }
  return value;
}

/**
 * Serialise agent input into the user message. JSON keeps it schema-agnostic
 * so the orchestrator does not have to know each agent's shape. Tabs+newlines
 * for readability in traces.
 */
function inputToUserMessage(input: unknown): string {
  return JSON.stringify(input, null, 2);
}

/**
 * Resolve, validate, call, audit. Returns AgentRun with tokens + latency so
 * caller can persist an llm_calls row without a second round trip.
 */
export async function runAgent<
  I extends ZodTypeAny,
  O extends ZodTypeAny,
>(
  agentId: string,
  input: unknown,
  ctx?: AgentRunContext,
  version?: string,
): Promise<AgentRun<z.output<O>>> {
  const registry = ctx?.agents ?? defaultAgentRegistry;
  const agent = registry.resolve<AgentDef<unknown, unknown, I, O>>(agentId, version);
  const provider = resolveProvider(agent as AgentDef, ctx);
  const source = ctx?.untrustedSource ?? 'user-input';
  const start = Date.now();

  const wrapped = wrapInputStrings(input, source);
  const parseResult = agent.inputSchema.safeParse(wrapped);
  if (!parseResult.success) {
    const latencyMs = Date.now() - start;
    const evt: AgentAuditEvent = {
      code: 'security.audit.agent_run',
      agentId: agent.id,
      version: agent.version,
      provider: provider.name,
      latencyMs,
      tokens: { prompt: null, completion: null, total: null },
      ok: false,
      error: `input schema failed: ${parseResult.error.message}`,
    };
    audit(evt);
    throw new Error(evt.error);
  }

  const { system, promptVersion } = resolveSystem(agent.systemPrompt);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: inputToUserMessage(parseResult.data) },
  ];

  try {
    const output = await provider.chatStructured({
      messages,
      schema: agent.outputSchema,
      ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
      ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
      meta: { promptId: agent.id, agentRole: agent.id, ...(promptVersion ? { promptVersion } : {}) },
    });
    const latencyMs = Date.now() - start;
    // ponytail: provider.chatStructured does not surface token counts on its
    // return type today (they land in the LlmCallHook). Pass nulls; upgrade
    // when the provider surface grows tokens on the return value.
    const evt: AgentAuditEvent = {
      code: 'security.audit.agent_run',
      agentId: agent.id,
      version: agent.version,
      provider: provider.name,
      latencyMs,
      tokens: { prompt: null, completion: null, total: null },
      ok: true,
    };
    audit(evt);
    return {
      output: output as z.output<O>,
      tokens: evt.tokens,
      latencyMs,
      promptVersion: promptVersion ?? `${agent.id}@${agent.version}`,
      provider: provider.name,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    audit({
      code: 'security.audit.agent_run',
      agentId: agent.id,
      version: agent.version,
      provider: provider.name,
      latencyMs,
      tokens: { prompt: null, completion: null, total: null },
      ok: false,
      error: message,
    });
    throw err;
  }
}
