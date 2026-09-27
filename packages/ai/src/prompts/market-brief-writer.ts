import { MarketBriefContentSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Synthesize a short weekly market brief for the candidate from precomputed
 * stats + a sample of representative job titles. Grounded: every notable
 * claim MUST cite a URL from the supplied sources list. The service filters
 * `sourceUrls` post-parse against the list, dropping any hallucinated links.
 *
 * Untrusted content: the job-title sample is wrapped as `job-description`
 * (adversarial prose from third-party listings). Stats are our own numbers,
 * not wrapped.
 */
export const MarketBriefWriterPrompt = register({
  id: 'market-brief-writer',
  version: '1.0.0',
  system: [
    'You write a concise weekly market brief for a job-seeking candidate.',
    'Every claim about the market must be grounded in the supplied stats or job-title sample. Do not invent numbers.',
    'When referencing a specific role or company, cite its URL from the sources list. Do not invent URLs.',
    'Aim for 3-5 sections, each with a heading, 2-6 sentence body, and any cited sourceUrls.',
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Candidate context:',
    '{{candidateContext}}',
    '',
    'Precomputed stats over the last {{windowDays}} days (from jobs matching the candidate\'s preferences):',
    '{{stats}}',
    '',
    'Available source URLs (only cite from this list):',
    '{{sources}}',
    '',
    'Sample of recent job titles (untrusted third-party content):',
    '{{jobSample}}',
    '',
    'Return JSON: {"sections": [{"heading": string (1-120 chars), "body": string (1-2000 chars),',
    ' "sourceUrls": string[] (0-20 URLs, each drawn verbatim from the sources list)}] (1-6 sections)}.',
  ].join('\n'),
  schema: MarketBriefContentSchema,
});
