import { describe, expect, it } from 'vitest';
import {
  promptCatalog,
  resumeFactCheck,
  tailoredResumeWriter,
  coverLetterGeneration,
  skillExtract,
  marketBriefSynthesis,
  assessmentGraderKnowledge,
  assessmentGraderCodeReview,
} from './index';

// Version pins per prompt. Bumping a prompt's version changes its audit hash;
// update this map in the same change (mirrors verify-prompt-versions.sh).
const EXPECTED_VERSIONS: Record<string, string> = {
  'resume-fact-check': '1.0.0',
  'tailored-resume-writer': '2.0.0',
  'cover-letter-generation': '2.0.0',
  'skill-extract': '1.0.0',
  'market-brief-synthesis': '1.0.0',
  'assessment-grader-knowledge': '1.0.0',
  'assessment-grader-code-review': '1.0.0',
};

const EXPECTED_IDS = Object.keys(EXPECTED_VERSIONS) as Array<keyof typeof EXPECTED_VERSIONS>;

describe('promptCatalog (C-P0.2)', () => {
  it('registers all ticket-scoped prompts at module load', () => {
    const ids = new Set(promptCatalog.list().map((p) => p.id));
    for (const id of EXPECTED_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it.each(EXPECTED_IDS)('resolves %s to a Prompt with id + version + template', (id) => {
    const p = promptCatalog.resolve(id);
    expect(p.id).toBe(id);
    expect(p.version).toBe(EXPECTED_VERSIONS[id]);
    expect(p.template.length).toBeGreaterThan(0);
  });

  it('each exported catalog entry matches its resolved registry entry (byte-identical)', () => {
    for (const entry of [
      resumeFactCheck,
      tailoredResumeWriter,
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
