import { describe, expect, it } from 'vitest';
import {
  promptCatalog,
  resumeFactCheck,
  coverLetterGeneration,
  skillExtract,
  marketBriefSynthesis,
  assessmentGraderKnowledge,
  assessmentGraderCodeReview,
} from './index';

const EXPECTED_IDS = [
  'resume-fact-check',
  'cover-letter-generation',
  'skill-extract',
  'market-brief-synthesis',
  'assessment-grader-knowledge',
  'assessment-grader-code-review',
] as const;

describe('promptCatalog (C-P0.2)', () => {
  it('registers all six ticket-scoped prompts at module load', () => {
    const ids = new Set(promptCatalog.list().map((p) => p.id));
    for (const id of EXPECTED_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it.each(EXPECTED_IDS)('resolves %s to a Prompt with id + version + template', (id) => {
    const p = promptCatalog.resolve(id);
    expect(p.id).toBe(id);
    expect(p.version).toBe('1.0.0');
    expect(p.template.length).toBeGreaterThan(0);
  });

  it('each exported catalog entry matches its resolved registry entry (byte-identical)', () => {
    for (const entry of [
      resumeFactCheck,
      coverLetterGeneration,
      skillExtract,
      marketBriefSynthesis,
      assessmentGraderKnowledge,
      assessmentGraderCodeReview,
    ]) {
      expect(promptCatalog.resolve(entry.id).template).toBe(entry.template);
    }
  });
});
