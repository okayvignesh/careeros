import { z } from 'zod';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * F.4: interview-prep-planner.
 *
 * Given the job description (untrusted), the company dossier
 * (grounded), and the user's applied resume variant (trusted), produce
 * a topic list the candidate should be ready to speak to. Each topic
 * cites the evidence fact IDs the candidate can lean on when speaking.
 *
 * Non-goals for this prompt:
 *   - Producing the talk-track text (that's `talk-track-generator`).
 *   - Booking mock-interview sessions (out of scope for the LLM).
 */

export const InterviewPrepPlanSchema = z.object({
  topics: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().min(3).max(200),
        source: z.enum(['job_description', 'company_dossier', 'resume_bullet', 'inferred']),
        rationale: z.string().min(5).max(500),
        evidenceFactIds: z.array(z.string()).max(10),
        suggestedDurationSec: z.number().int().min(30).max(300),
      }),
    )
    .min(3)
    .max(12),
});

export type InterviewPrepPlan = z.infer<typeof InterviewPrepPlanSchema>;

export const InterviewPrepPlannerPrompt = register({
  id: 'interview-prep-planner',
  version: '1.0.0',
  system: [
    'You author interview preparation plans for a career-development tool.',
    'A plan is a short list (3-12) of topics the candidate should be ready to discuss.',
    'Every topic MUST cite where it came from and which of the candidate evidence facts back it.',
    'suggestedDurationSec is 60-90 for behavioural topics, 120-180 for deep technical ones.',
    'You output JSON matching the schema exactly. Return valid JSON only, no prose around it.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'JOB DESCRIPTION (untrusted, from the job posting):',
    '{{jobDescription}}',
    '',
    'COMPANY DOSSIER (grounded facts about the company):',
    '{{companyDossier}}',
    '',
    'RESUME VARIANT (the resume the candidate submitted for this role):',
    '{{resumeSummary}}',
    '',
    'CANDIDATE EVIDENCE (facts the candidate can cite, with ids):',
    '{{evidenceCatalog}}',
    '',
    'Return JSON: {"topics": [{"id": string (kebab-case, <=64 chars), "title": string,',
    ' "source": "job_description"|"company_dossier"|"resume_bullet"|"inferred",',
    ' "rationale": string (5-500 chars), "evidenceFactIds": string[] (<=10 ids from CANDIDATE EVIDENCE),',
    ' "suggestedDurationSec": integer (30-300)}]}',
  ].join('\n'),
  schema: InterviewPrepPlanSchema,
});
