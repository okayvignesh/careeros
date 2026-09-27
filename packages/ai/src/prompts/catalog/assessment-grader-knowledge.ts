// C-P0.2a: catalog entry for the knowledge-question grader prompt.
// Runtime rendering lives in ../knowledge-grader.ts (PromptDef).
import type { Prompt } from './registry';

const system = [
  'You grade a candidate\'s answer to a technical knowledge question.',
  'You are strict about factual correctness and generous about phrasing.',
  'Score = fraction of key points meaningfully covered, in [0, 1].',
  'Paraphrase counts; wrong claims do not.',
  'Return valid JSON only, matching the schema exactly. Do not invent key points.',
].join(' ');

const user = [
  'Question:',
  '{{question}}',
  '',
  'Key points to look for (case-insensitive; paraphrase is fine):',
  '{{keyPoints}}',
  '',
  'Candidate answer:',
  '{{answer}}',
  '',
  'Return JSON: {"score": number in [0,1], "hits": string[], "misses": string[], "reasoning": string}.',
].join('\n');

export const assessmentGraderKnowledge: Prompt = {
  id: 'assessment-grader-knowledge',
  version: '1.0.0',
  schemaVersion: 'KnowledgeGradeSchema@1',
  description: 'Grade a candidate answer against a hidden key-points list.',
  template: `${system}\n\n${user}`,
};
