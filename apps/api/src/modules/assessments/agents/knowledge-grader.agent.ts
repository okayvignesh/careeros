// C-P2.8c: knowledge-grader agent registration. Wraps the C-P0.2 catalog
// prompt as an AgentDef so downstream code paths (planned interviewer /
// remediation composer / debrief) can grade a candidate answer through the
// uniform runAgent(...) surface.
//
// Ponytail: no code duplication with assessments.service. This file
// REGISTERS the agent shape only; the existing gradeKnowledgeAttempt path
// keeps its runLlmGraderOrFallback wiring untouched (per the task ceiling —
// "do NOT touch the existing service"). Callers that adopt the agent surface
// resolve it through the shared AgentRegistry.
import { z } from 'zod';
import { KnowledgeGradeSchema } from '@careeros/shared';
import type { AgentDef, AgentRegistry } from '@careeros/ai';

const InputSchema = z.object({
  question: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
  answer: z.string().min(1),
});

export type KnowledgeGraderInput = z.infer<typeof InputSchema>;
export type KnowledgeGraderOutput = z.infer<typeof KnowledgeGradeSchema>;

/**
 * System prompt bound directly (rather than PromptRef) so an agent-only
 * consumer does not have to also depend on the prompt-registry import chain.
 * Text mirrors the C-P0.2 catalog entry verbatim; version bump is the
 * signal that these have drifted.
 */
const SYSTEM = [
  "You grade a candidate's answer to a technical knowledge question.",
  'You are strict about factual correctness and generous about phrasing.',
  'Score = fraction of key points meaningfully covered, in [0, 1].',
  'Paraphrase counts; wrong claims do not.',
  'Return valid JSON only, matching the schema exactly. Do not invent key points.',
].join(' ');

export const knowledgeGraderAgent: AgentDef<
  KnowledgeGraderInput,
  KnowledgeGraderOutput,
  typeof InputSchema,
  typeof KnowledgeGradeSchema
> = {
  id: 'knowledge-grader',
  version: '1.0.0',
  description: 'Grade a candidate answer against a hidden key-points list; returns score + hits + misses.',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: KnowledgeGradeSchema,
  temperature: 0,
  maxTokens: 1024,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerKnowledgeGraderAgent(registry: AgentRegistry): void {
  registry.register(knowledgeGraderAgent);
}
