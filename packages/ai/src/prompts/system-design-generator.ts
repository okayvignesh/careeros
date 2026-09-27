import { GeneratedSystemDesignSchema } from '@careeros/shared';
import { register } from './registry';

/**
 * Generate one system-design scenario appropriate for the candidate's skill +
 * difficulty. Constraints are hard non-negotiables (RPS, latency, storage
 * class, geography) that the design must respect.
 *
 * Difficulty guide:
 *   easy   — single-service, moderate load, one non-trivial constraint.
 *   medium — multi-service, one cross-cutting concern (consistency, backfill,
 *            multi-region), 2-3 constraints.
 *   hard   — 3+ concerns interacting (scale + reliability + cost), 3-5
 *            constraints, at least one non-obvious workload characteristic.
 *
 * Output is stored on `question` with kind='system-design'; scenario in `prompt`,
 * constraints as JSON in `answerHint`, dimensions carried on the response.
 */
export const SystemDesignGeneratorPrompt = register({
  id: 'system-design-generator',
  version: '1.0.0',
  system: [
    'You author system-design scenarios for a career-development tool.',
    'Each scenario is a concrete real-world problem the candidate would encounter at work.',
    'You include hard constraints (RPS, latency, cost budget, geography, consistency). No vague "at scale" hand-waving.',
    'Return valid JSON only, matching the schema exactly. Do not embed the constraints inside the scenario text.',
  ].join(' '),
  userTemplate: [
    'Skill: {{skillName}} (id: {{skillId}})',
    'Difficulty: {{difficulty}}',
    '',
    'Difficulty guide:',
    '- easy: single service, one non-trivial constraint.',
    '- medium: multi-service + one cross-cutting concern.',
    '- hard: 3+ concerns interacting; non-obvious workload characteristic.',
    '',
    'Return JSON: {"scenario": string (40-1200 chars, concrete problem to design),',
    ' "constraints": string[] (1-8 items, each 4-200 chars, quantified where relevant),',
    ' "difficulty": "easy" | "medium" | "hard"}.',
  ].join('\n'),
  schema: GeneratedSystemDesignSchema,
});
