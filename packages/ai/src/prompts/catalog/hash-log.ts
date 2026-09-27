// C-P0.2b: prompt-use audit hook. Every downstream LLM call that renders a
// registered prompt logs (promptId, version, hash, callerModule, timestamp)
// via an injectable hook — same pattern as wrap.ts's setWrapAuditHook and
// injection-scan.ts's setInjectionAuditHook (A-H5).
//
// The hook is DI so packages/ai stays free of the api's pino logger; the api
// bootstrap wires the hook to persist rows into llm_calls (or a dedicated
// prompt_use_log table when we split it out).
import { PromptRegistry, type Prompt } from './registry';

export interface PromptUseEvent {
  code: 'ai.prompt.use';
  promptId: string;
  version: string;
  hash: string;
  callerModule: string;
  timestamp: string; // ISO-8601
}

export type PromptUseHook = (event: PromptUseEvent) => void;

let hook: PromptUseHook | null = null;

/** Register a callback for every prompt-use audit event. Null clears. */
export function setPromptUseHook(next: PromptUseHook | null): void {
  hook = next;
}

export interface LogPromptUseInput {
  promptId: string;
  version: string;
  callerModule: string;
  // Optional: pass the resolved prompt to avoid re-resolving for the hash.
  prompt?: Prompt;
}

/**
 * Emit a prompt-use audit event. When `prompt` is supplied, hashes it directly;
 * otherwise skips the hash (call sites that don't have the prompt in hand can
 * still log the id/version without recomputing content).
 *
 * Hook is fire-and-forget: exceptions from the hook are swallowed so a broken
 * audit sink never fails a live LLM call.
 */
export function logPromptUse(input: LogPromptUseInput): void {
  if (!hook) return;
  const event: PromptUseEvent = {
    code: 'ai.prompt.use',
    promptId: input.promptId,
    version: input.version,
    hash: input.prompt ? PromptRegistry.hashOf(input.prompt) : '',
    callerModule: input.callerModule,
    timestamp: new Date().toISOString(),
  };
  try {
    hook(event);
  } catch {
    /* audit must never throw */
  }
}
