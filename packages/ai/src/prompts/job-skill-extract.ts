import { JobSkillExtractionSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Extract skill IDs from a job description, constrained to the caller-supplied
 * catalogue of known skill IDs. The job description is untrusted content
 * (wrapped as `job-description` sourceKind), so the grader must NOT invent
 * IDs or free-form text. The service post-validates that every returned ID
 * exists in the catalogue and drops unknowns.
 */
export const JobSkillExtractPrompt = register({
  id: 'job-skill-extract',
  version: '1.0.0',
  system: [
    'You extract technical skill mentions from job descriptions.',
    'You return ONLY IDs from the supplied `known skill IDs` list — no free-form text, no new IDs.',
    'Prefer explicit mentions in the description over inferred ones; when unsure, omit.',
    'Return valid JSON only, matching the schema exactly. Empty array is fine when nothing matches.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Known skill IDs (choose from this list only; IDs are lowercase slugs):',
    '{{catalogue}}',
    '',
    'Job title: {{title}}',
    'Company: {{company}}',
    '',
    'Job description:',
    '{{description}}',
    '',
    'Return JSON: {"skillIds": string[] (0-20 IDs, each drawn verbatim from the catalogue above)}.',
  ].join('\n'),
  schema: JobSkillExtractionSchema,
});
