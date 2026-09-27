// C-P2.8c: code-review grader agent registration. Same pattern as
// knowledge-grader.agent.ts — wraps the C-P0.2 catalog prompt so the runAgent
// surface can grade a candidate's review findings against a hidden defect
// list and return precision + recall + F1.
import { z } from 'zod';
import { CodeReviewGradeSchema } from '@careeros/shared';
import type { AgentDef, AgentRegistry } from '@careeros/ai';

const InputSchema = z.object({
  diff: z.string().min(1),
  defects: z.array(z.string().min(1)).min(1),
  findings: z.array(z.string()).default([]),
});

export type CodeReviewGraderInput = z.infer<typeof InputSchema>;
export type CodeReviewGraderOutput = z.infer<typeof CodeReviewGradeSchema>;

const SYSTEM = [
  "You grade a candidate's code-review findings against a hidden defect list.",
  'Match each finding to at most one defect based on meaning, not exact wording.',
  'Paraphrase counts; wrong claims about the code do not.',
  'Score = F1 of precision and recall over the matched defects.',
  'Return valid JSON only, matching the schema exactly. Do not invent defects that are not in the answer key.',
].join(' ');

export const codeReviewGraderAgent: AgentDef<
  CodeReviewGraderInput,
  CodeReviewGraderOutput,
  typeof InputSchema,
  typeof CodeReviewGradeSchema
> = {
  id: 'code-review-grader',
  version: '1.0.0',
  description: 'Score reviewer findings against a hidden defect list via F1 (precision + recall).',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: CodeReviewGradeSchema,
  temperature: 0,
  maxTokens: 1024,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerCodeReviewGraderAgent(registry: AgentRegistry): void {
  registry.register(codeReviewGraderAgent);
}
