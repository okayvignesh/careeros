// System-design-grader agent. Pairs with the local prompt at
// prompts/system-design-grader.ts. Mirrors the debugging-grader shape:
// callable class for AssessmentsService + AgentDef registration for the
// shared registry surface.
//
// Ponytail: rubric is passed in as a pre-rendered string so this agent stays
// rubric-agnostic. Current call site renders SYSTEM_DESIGN_RUBRIC into the
// `rubric` field; swap in a per-question rubric when questions carry their
// own.
import { z } from 'zod';
import { RubricGradeSchema, type RubricGradeResponse } from '@careeros/shared';
import type { AgentDef, AgentRegistry, AIProvider } from '@careeros/ai';
import { renderSystemDesignGraderPrompt } from '../prompts/system-design-grader';

const InputSchema = z.object({
  scenario: z.string().min(1),
  constraints: z.string(),
  rubric: z.string().min(1),
  design: z.string().min(1),
});

export type SystemDesignGraderInput = z.infer<typeof InputSchema>;

export class SystemDesignGraderAgent {
  readonly id = 'system-design-grader';
  readonly version = '1.0.0';

  async grade(provider: AIProvider, inputs: SystemDesignGraderInput): Promise<RubricGradeResponse> {
    const parsed = InputSchema.parse(inputs);
    const rendered = renderSystemDesignGraderPrompt(parsed);
    // chatStructured is schema-aware (A-H5 retry inside DeepSeekProvider
    // re-prompts on invalid shapes); it returns z.output<schema> directly.
    // The service clamps dimension scores to 1..5 downstream in
    // gradeSystemDesignWithLlmOrFallback, so a slightly out-of-band provider
    // response still normalizes.
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
  "You grade a candidate's system-design write-up against a supplied rubric.",
  'For each rubric dimension, pick the level (1..5) whose descriptor best matches the design and cite the evidence in one short note.',
  'Do not invent claims that are not in the design. Do not reward buzzwords absent from the design text.',
  'Overall score = mean of dimension scores / 5, in [0, 1].',
  'Return valid JSON only, matching the schema exactly. `dimensions[]` must cover every dimension in the rubric, in the same order.',
].join(' ');

export const systemDesignGraderAgent: AgentDef<
  SystemDesignGraderInput,
  RubricGradeResponse,
  typeof InputSchema,
  typeof RubricGradeSchema
> = {
  id: 'system-design-grader',
  version: '1.0.0',
  description: 'Grade a system-design write-up against a rubric; returns per-dimension score + overall.',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: RubricGradeSchema,
  temperature: 0,
  maxTokens: 1536,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerSystemDesignGraderAgent(registry: AgentRegistry): void {
  registry.register(systemDesignGraderAgent);
}
