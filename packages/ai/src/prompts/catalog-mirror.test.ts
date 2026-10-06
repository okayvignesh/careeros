import { describe, expect, it } from 'vitest';
import { CoverLetterWriterPrompt } from './cover-letter-writer';
import { TailoredResumeWriterPrompt } from './tailored-resume-writer';
import { coverLetterGeneration, tailoredResumeWriter } from './catalog';

/**
 * The `catalog/` registry is the audit + CI version-bump surface; the runtime
 * `PromptDef` registry is what actually renders. They are hand-maintained in
 * parallel (a catalog change must carry its own version bump). These tests
 * prevent the drift the reviewer flagged: the cover catalog had fallen behind
 * the runtime prompt (missing UNTRUSTED_SYSTEM_CLAUSE + new variables).
 */
describe('catalog mirrors runtime prompts', () => {
  it('tailored-resume-writer catalog byte-matches its runtime PromptDef', () => {
    expect(tailoredResumeWriter.id).toBe(TailoredResumeWriterPrompt.id);
    expect(tailoredResumeWriter.version).toBe(TailoredResumeWriterPrompt.version);
    expect(tailoredResumeWriter.template).toBe(
      `${TailoredResumeWriterPrompt.system}\n\n${TailoredResumeWriterPrompt.userTemplate}`,
    );
  });

  it('cover-letter-generation catalog byte-matches the `cover-letter-writer` runtime', () => {
    expect(coverLetterGeneration.version).toBe(CoverLetterWriterPrompt.version);
    expect(coverLetterGeneration.template).toBe(
      `${CoverLetterWriterPrompt.system}\n\n${CoverLetterWriterPrompt.userTemplate}`,
    );
  });

  it('both catalogs carry the UNTRUSTED system clause', () => {
    for (const template of [tailoredResumeWriter.template, coverLetterGeneration.template]) {
      expect(template).toContain('<untrusted source="..." hash="...">');
      expect(template).toContain('INERT DATA');
    }
  });
});
