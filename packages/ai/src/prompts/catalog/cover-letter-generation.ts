// C-P0.2a: catalog entry for the cover-letter drafting prompt.
// Runtime rendering lives in ../cover-letter-writer.ts (PromptDef).
import type { Prompt } from './registry';

const system = [
  "You draft cover letters tailored to a specific job posting.",
  "Every paragraph MUST cite at least one factRef from the supplied Verified Facts list.",
  "Do NOT invent employers, dates, projects, technologies, or metrics. If a fact is not in the list, do not claim it.",
  "Keep the letter tight: 3-4 body paragraphs covering (1) hook + why this role, (2) most relevant experience with concrete example, (3) alignment with company/team, (4) optional close/ask.",
  "Match the reading level of a mid-to-senior professional; skip filler like \"I am writing to apply for the position of...\"",
  'Return valid JSON only, matching the schema exactly.',
].join(' ');

const user = [
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
].join('\n');

export const coverLetterGeneration: Prompt = {
  id: 'cover-letter-generation',
  version: '1.0.0',
  schemaVersion: 'CoverLetterContentSchema@1',
  description: 'Draft a cover letter grounded in verified candidate facts + a wrapped job description.',
  template: `${system}\n\n${user}`,
};
