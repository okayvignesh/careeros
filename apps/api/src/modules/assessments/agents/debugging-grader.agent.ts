// Debugging-grader agent. Pairs with the local prompt at
// prompts/debugging-grader.ts. Two shapes:
//   1) `DebuggingGraderAgent` class with `grade(provider, inputs)` — the real
//      callable used by AssessmentsService at submit time.
//   2) `AgentDef` registration (same shape as knowledge-grader.agent.ts) so
//      the shared agent-registry surface lists every assessment grader.
//
// Ponytail: rubric criteria (correctness + minimality) hardcoded in the shared
// `DebuggingGradeSchema`; move to a per-Question grading-rubric column when a
// different debugging question wants different criteria.
import { z } from 'zod';
import { DebuggingGradeSchema, type DebuggingGrade } from '@careeros/shared';
import type { AgentDef, AgentRegistry, AIProvider } from '@careeros/ai';
import { renderDebuggingGraderPrompt } from '../prompts/debugging-grader';

const InputSchema = z.object({
  description: z.string(),
  brokenCode: z.string().min(1),
  rootCause: z.string(),
  fix: z.string().min(1),
});

export type DebuggingGraderInput = z.infer<typeof InputSchema>;

export class DebuggingGraderAgent {
  readonly id = 'debugging-grader';
  readonly version = '1.0.0';

  async grade(provider: AIProvider, inputs: DebuggingGraderInput): Promise<DebuggingGrade> {
    const parsed = InputSchema.parse(inputs);
    const rendered = renderDebuggingGraderPrompt(parsed);
    // chatStructured is schema-aware (A-H5 retry inside DeepSeekProvider
    // re-prompts on invalid shapes); it returns z.output<schema> directly.
    // No defensive re-parse needed — the service clamps/normalizes
    // downstream (e.g. system-design score caps) and treats a thrown parse
    // error here the same as a provider failure (-> rule fallback).
    return provider.chatStructured({
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      schema: rendered.schema,
      temperature: 0,
    });
  }
}

const SYSTEM = [
  'You grade a debugging attempt.',
  "Judge whether the candidate's fix addresses the described root cause.",
  'Cosmetic changes that do not fix the root cause score 0 on correctness, regardless of minimality.',
  'Small, targeted fixes score high on minimality; sweeping rewrites lower it.',
  'Return valid JSON only, matching the schema exactly.',
].join(' ');

export const debuggingGraderAgent: AgentDef<
  DebuggingGraderInput,
  DebuggingGrade,
  typeof InputSchema,
  typeof DebuggingGradeSchema
> = {
  id: 'debugging-grader',
  version: '1.0.0',
  description: 'Grade a debugging fix on correctness (addresses root cause) + minimality (targeted change).',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: DebuggingGradeSchema,
  temperature: 0,
  maxTokens: 1024,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerDebuggingGraderAgent(registry: AgentRegistry): void {
  registry.register(debuggingGraderAgent);
}
