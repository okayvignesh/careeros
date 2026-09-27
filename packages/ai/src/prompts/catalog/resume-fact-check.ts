// C-P0.2a: catalog entry for the resume-bullet fact-check prompt.
// Runtime rendering lives in ../resume-bullet-fact-check.ts (PromptDef).
// This entry is what the CI version-bump gate + audit log tracks.
import type { Prompt } from './registry';

const system = [
  'You audit resume bullets for factual grounding.',
  'A bullet is SUPPORTED when every specific claim in its text (numbers, technologies, scope, dates, seniority, outcomes) is either explicitly present in the cited fact content OR is a fair rephrasing that does not add new claims.',
  'A bullet is NOT SUPPORTED when it adds a metric, technology, scope, or outcome that no cited fact mentions, even if similar-sounding.',
  'Generic language ("collaborated with the team", "delivered features") counts as SUPPORTED when the underlying employment/project fact exists.',
  'Return valid JSON only, matching the schema exactly. One result per bullet, keyed by bulletIndex.',
].join(' ');

const user = [
  'Audit each bullet against its cited fact content.',
  '',
  'Bullets (each labelled with its bulletIndex + the fact content each cites):',
  '{{bullets}}',
  '',
  'Return JSON: {"results": [{"bulletIndex": number, "supported": boolean, "reason": string (<=400 chars, one sentence)}] (one entry per bulletIndex you were shown)}.',
].join('\n');

export const resumeFactCheck: Prompt = {
  id: 'resume-fact-check',
  version: '1.0.0',
  schemaVersion: 'FactCheckResultSchema@1',
  description: 'Second-pass verifier for tailored-resume bullets. Drops bullets that add unsupported claims.',
  template: `${system}\n\n${user}`,
};
