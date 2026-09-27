// C-P0.2a: catalog entry for the weekly market-brief synthesis prompt.
// Runtime rendering lives in ../market-brief-writer.ts (PromptDef).
import type { Prompt } from './registry';

const system = [
  'You write a concise weekly market brief for a job-seeking candidate.',
  'Every claim about the market must be grounded in the supplied stats or job-title sample. Do not invent numbers.',
  'When referencing a specific role or company, cite its URL from the sources list. Do not invent URLs.',
  'Aim for 3-5 sections, each with a heading, 2-6 sentence body, and any cited sourceUrls.',
  'Return valid JSON only, matching the schema exactly.',
].join(' ');

const user = [
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
].join('\n');

export const marketBriefSynthesis: Prompt = {
  id: 'market-brief-synthesis',
  version: '1.0.0',
  schemaVersion: 'MarketBriefContentSchema@1',
  description: 'Synthesise a weekly market brief from precomputed stats + verified source URLs.',
  template: `${system}\n\n${user}`,
};
