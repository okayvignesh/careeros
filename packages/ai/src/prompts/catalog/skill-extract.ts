// C-P0.2a: catalog entry for the job-description skill-extraction prompt.
// Runtime rendering lives in ../job-skill-extract.ts (PromptDef).
import type { Prompt } from './registry';

const system = [
  'You extract technical skill mentions from job descriptions.',
  'You return ONLY IDs from the supplied `known skill IDs` list — no free-form text, no new IDs.',
  'Prefer explicit mentions in the description over inferred ones; when unsure, omit.',
  'Return valid JSON only, matching the schema exactly. Empty array is fine when nothing matches.',
].join(' ');

const user = [
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
].join('\n');

export const skillExtract: Prompt = {
  id: 'skill-extract',
  version: '1.0.0',
  schemaVersion: 'JobSkillExtractionSchema@1',
  description: 'Extract skill IDs from a wrapped job description, constrained to a supplied catalogue.',
  template: `${system}\n\n${user}`,
};
