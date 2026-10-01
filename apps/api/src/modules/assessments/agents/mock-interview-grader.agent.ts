// Mock-interview-grader agent. Pairs with the local prompt at
// prompts/mock-interview-grader.ts. Mirrors the debugging-grader shape:
// callable class for AssessmentsService + AgentDef registration for the
// shared registry surface.
//
// Ponytail: 3-question shape (2 technical + 1 behavioral) is pinned in the
// MockInterviewGradeSchema via `.length(3)`. Change the schema when the arena
// grows multi-turn interviews.
import { z } from 'zod';
import { MockInterviewGradeSchema, type MockInterviewGrade } from '@careeros/shared';
import type { AgentDef, AgentRegistry, AIProvider } from '@careeros/ai';
import { renderMockInterviewGraderPrompt } from '../prompts/mock-interview-grader';

const InputSchema = z.object({
  scenario: z.string(),
  // Rendered as "N. [kind] prompt\n   Key points: ..." lines; the service does
  // the formatting before handing in. Grader receives it as one blob.
  questions: z.string().min(1),
  answers: z.string().min(1),
});

export type MockInterviewGraderInput = z.infer<typeof InputSchema>;

export class MockInterviewGraderAgent {
  readonly id = 'mock-interview-grader';
  readonly version = '1.0.0';

  async grade(provider: AIProvider, inputs: MockInterviewGraderInput): Promise<MockInterviewGrade> {
    const parsed = InputSchema.parse(inputs);
    const rendered = renderMockInterviewGraderPrompt(parsed);
    // chatStructured is schema-aware (A-H5 retry inside DeepSeekProvider
    // re-prompts on invalid shapes); it returns z.output<schema> directly.
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
  "You grade a candidate's mock-interview session (3 questions, 3 answers).",
  'Score each question independently against its own keyPoints; paraphrase counts, wrong claims do not.',
  'Behavioral questions score on evidence-of-experience (concrete example, own role, outcome), not on buzzword density.',
  'Overall = mean of per-question scores.',
  'Return valid JSON only, matching the schema exactly. Do not invent key points.',
].join(' ');

export const mockInterviewGraderAgent: AgentDef<
  MockInterviewGraderInput,
  MockInterviewGrade,
  typeof InputSchema,
  typeof MockInterviewGradeSchema
> = {
  id: 'mock-interview-grader',
  version: '1.0.0',
  description: 'Grade a 3-question mock interview per Q + overall, with panel-style summary.',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: MockInterviewGradeSchema,
  temperature: 0,
  maxTokens: 1536,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerMockInterviewGraderAgent(registry: AgentRegistry): void {
  registry.register(mockInterviewGraderAgent);
}
