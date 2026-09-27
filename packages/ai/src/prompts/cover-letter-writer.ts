import { CoverLetterContentSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Draft a cover letter tailored to a specific job. Same grounded-generation
 * contract as `tailored-resume-writer`: every paragraph MUST cite at least
 * one factRef from the numbered verified-fact list, and downstream service
 * post-filters cited IDs + runs `resume-bullet-fact-check` (repurposed for
 * paragraphs) to drop fabricated-claim paragraphs.
 *
 * Job description is untrusted (wrapped as `job-description`).
 */
export const CoverLetterWriterPrompt = register({
  id: 'cover-letter-writer',
  version: '1.0.0',
  system: [
    "You draft cover letters tailored to a specific job posting.",
    "Every paragraph MUST cite at least one factRef from the supplied Verified Facts list.",
    "Do NOT invent employers, dates, projects, technologies, or metrics. If a fact is not in the list, do not claim it.",
    "Keep the letter tight: 3-4 body paragraphs covering (1) hook + why this role, (2) most relevant experience with concrete example, (3) alignment with company/team, (4) optional close/ask.",
    "Match the reading level of a mid-to-senior professional; skip filler like \"I am writing to apply for the position of...\"",
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Job title: {{jobTitle}}',
    'Company: {{jobCompany}}',
    '',
    'Job description:',
    '{{jobDescription}}',
    '',
    'Candidate verified facts (numbered; cite these IDs verbatim in factRefs):',
    '{{facts}}',
    '',
    'Return JSON: {"greeting": string (3-200 chars),',
    ' "paragraphs": [{"text": string (10-1200 chars), "factRefs": string[] (0-6 IDs from the numbered list)}] (2-6 paragraphs),',
    ' "closing": string (3-200 chars)}.',
  ].join('\n'),
  schema: CoverLetterContentSchema,
});
