import { TailoredResumeContentSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Tailor a candidate's resume to a specific job. The candidate's verified
 * facts are supplied as a numbered list with stable IDs; every bullet the LLM
 * produces MUST cite at least one `factRef` from that list. The service
 * post-filters cited IDs against the supplied set (hallucination guard) and
 * drops bullets that end up with zero valid refs.
 *
 * The job description is untrusted content (wrapped as `job-description`).
 * Facts are our own data, not wrapped.
 *
 * v2.0.0 (P2b): target-role override + target market + region are now supplied
 * so the writer frames the resume for the user's targeting profile rather than
 * blindly echoing `job.title`. Region only influences framing/conventions —
 * the template is selected in code, never by the model.
 */
export const TailoredResumeWriterPrompt = register({
  id: 'tailored-resume-writer',
  version: '2.0.0',
  system: [
    'You tailor a candidate\'s resume to a specific job posting.',
    'Every bullet you write MUST cite at least one factRef from the supplied Verified Facts list.',
    'Do NOT invent employers, dates, projects, technologies, or metrics. If a fact isn\'t in the list, don\'t claim it.',
    'Rephrase and reorder facts to emphasise what matches the job. Never fabricate.',
    'Write for the TARGET ROLE and TARGET REGION given below; adapt emphasis and conventions to that market.',
    'Section headings should be classic ATS-friendly: Summary, Experience, Skills, Projects, Education.',
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Job title (raw posting title): {{jobTitle}}',
    'Company: {{jobCompany}}',
    'Target role (frame the resume for this role): {{targetRole}}',
    'Target market: {{targetMarket}}',
    'Target region: {{region}}',
    '',
    'Job description:',
    '{{jobDescription}}',
    '',
    'Candidate verified facts (numbered — cite these IDs verbatim in factRefs):',
    '{{facts}}',
    '',
    'Skills the candidate has evidence for (from their tracker):',
    '{{candidateSkills}}',
    '',
    'Return JSON: {"summary": string (10-600 chars, 2-3 sentences aligned to the job),',
    ' "sections": [{"heading": string, "bullets": [{"text": string (4-400 chars),',
    '   "factRefs": string[] (0-6 IDs drawn verbatim from the numbered list above)}] (1-10 per section)}] (1-8 sections)}.',
  ].join('\n'),
  schema: TailoredResumeContentSchema,
});
