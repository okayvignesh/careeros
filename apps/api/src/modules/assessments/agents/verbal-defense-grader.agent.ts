// Verbal-defense-grader agent. Pairs with the local prompt at
// prompts/verbal-defense-grader.ts and the local grade schema in that same
// file. Mirrors the mock-interview-grader shape: callable class for
// AssessmentsService + AgentDef registration for the shared registry surface.
//
// The rule-based fallback (`gradeVerbalDefense`) exists so a run is still
// scored when no LLM provider is configured — same contract as the other
// graders (grader: 'rule' tag on the attempt).
import { z } from 'zod';
import type { AgentDef, AgentRegistry, AIProvider } from '@careeros/ai';
import {
  renderVerbalDefenseGraderPrompt,
  VerbalDefenseGradeSchema,
  type VerbalDefenseGrade,
} from '../prompts/verbal-defense-grader';

const InputSchema = z.object({
  prompt: z.string().min(1),
  // Rendered keyPoints as a bullet list; the service formats before handing in.
  keyPoints: z.string(),
  transcript: z.string().min(1),
});

export type VerbalDefenseGraderInput = z.infer<typeof InputSchema>;

export class VerbalDefenseGraderAgent {
  readonly id = 'verbal-defense-grader';
  readonly version = '1.0.0';

  async grade(provider: AIProvider, inputs: VerbalDefenseGraderInput): Promise<VerbalDefenseGrade> {
    const parsed = InputSchema.parse(inputs);
    const rendered = renderVerbalDefenseGraderPrompt(parsed);
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
  "You grade a candidate's spoken answer from its transcript against the question's key points.",
  'technicalAccuracy = key-point coverage; communication = clarity/structure/conciseness.',
  'Overall = mean of the two axes. Return valid JSON only, matching the schema exactly.',
].join(' ');

export const verbalDefenseGraderAgent: AgentDef<
  VerbalDefenseGraderInput,
  VerbalDefenseGrade,
  typeof InputSchema,
  typeof VerbalDefenseGradeSchema
> = {
  id: 'verbal-defense-grader',
  version: '1.0.0',
  description: 'Grade a verbal-defense transcript for technical accuracy + communication.',
  systemPrompt: SYSTEM,
  inputSchema: InputSchema,
  outputSchema: VerbalDefenseGradeSchema,
  temperature: 0,
  maxTokens: 1024,
  provider: 'deepseek',
};

/** Register this agent into the supplied registry. Called from boot wiring. */
export function registerVerbalDefenseGraderAgent(registry: AgentRegistry): void {
  registry.register(verbalDefenseGraderAgent);
}

/**
 * Deterministic fallback grader. `technicalAccuracy` = fraction of key points
 * whose significant tokens appear in the transcript; `communication` scales
 * with answer length (a 90+ word answer is treated as complete, a one-liner as
 * thin). Deliberately simple — it is the floor when no LLM is wired.
 */
export function gradeVerbalDefense(transcript: string, keyPoints: string[]): VerbalDefenseGrade {
  const text = transcript.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const kp of keyPoints) {
    if (mentions(text, kp)) hits.push(kp);
    else misses.push(kp);
  }
  const technicalAccuracy = keyPoints.length > 0 ? hits.length / keyPoints.length : 0;
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  const communication = Math.max(0, Math.min(1, words / 90));
  const score = (technicalAccuracy + communication) / 2;
  return {
    score,
    technicalAccuracy,
    communication,
    hits,
    misses,
    reasoning:
      keyPoints.length > 0
        ? `Key-point coverage ${hits.length}/${keyPoints.length}; answer length ${words} words.`
        : `No key points supplied; scored on length (${words} words) only.`,
  };
}

/** True when every significant token of `phrase` appears in `text`. */
function mentions(text: string, phrase: string): boolean {
  const tokens = phrase
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 3);
  if (tokens.length === 0) return text.includes(phrase.toLowerCase());
  return tokens.every((t) => text.includes(t));
}
