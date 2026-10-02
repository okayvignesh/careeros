import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderResumePdf } from './index';
import { SAMPLE_RESUME, allBullets } from './__fixtures__/sample-resume';
import type { ResumePdfProps } from './templates/ats-first';

/**
 * G2. ATS-lint per-rule tests.
 *
 * The "linter" shipped in the P4 series lives as text-predicate assertions on
 * the extracted PDF of a `ResumeDoc`. There is no `lint.ts` module to import;
 * the rules ARE regex/predicates over the extracted text. This file extracts
 * each rule into a named predicate, runs it against the real render output
 * for both a clean fixture (must pass) and a crafted bad input (must fire).
 *
 * One test per rule + one sanity "clean fixture = zero findings" sweep.
 *
 * Shape of each test:
 *   positive: render SAMPLE_RESUME, extract text, run the rule, expect [].
 *   negative: run the rule against text that trips it, expect >=1 finding.
 * If the rule were disabled (always returns []), the negative half fails.
 *
 * ponytail: rules are inlined here rather than extracted to a shared
 * `lint.ts`. The DEFERRED entry references `packages/resume-render/lint.ts`
 * which does not exist; a test-only stream must not invent production
 * modules. Extract to `lint.ts` the moment a second caller (e.g. the resume
 * studio UI that renders a pass/fail panel per screen 41) needs the same
 * predicates server-side.
 */

// ---------- rules ----------

/** Rule 1: bullets use ONE glyph consistently and every bullet line starts with one. */
function ruleConsistentBulletGlyph(text: string, expectedBulletCount: number): string[] {
  const bulletLines = text.split('\n').filter((l) => /^[\-•–]/.test(l));
  const findings: string[] = [];
  if (bulletLines.length !== expectedBulletCount) {
    findings.push(
      `bullet-count: extracted ${bulletLines.length} bullet lines, expected ${expectedBulletCount}`,
    );
  }
  const glyphs = new Set(bulletLines.map((l) => l[0]));
  if (glyphs.size > 1) {
    findings.push(`bullet-glyph: mixed glyphs ${[...glyphs].join(',')}`);
  }
  return findings;
}

/** Rule 2: no unicode fraction glyphs and no "N/M" standalone pagination lines. */
function ruleNoFractionPageNumbers(text: string): string[] {
  const findings: string[] = [];
  if (/[¼-¾⅐-⅞]/.test(text)) {
    findings.push('fraction-glyph: unicode fraction character present');
  }
  if (/^\s*\d+\s*\/\s*\d+\s*$/m.test(text)) {
    findings.push('page-number: standalone N/M pagination line present');
  }
  return findings;
}

/** Rule 3: no invisible / zero-width characters (BOM, ZWSP, ZWNJ, ZWJ, word-joiner). */
function ruleNoZeroWidthArtifacts(text: string): string[] {
  if (/[﻿​‌‍⁠]/.test(text)) {
    return ['zero-width: BOM/ZWSP/ZWNJ/ZWJ/word-joiner present'];
  }
  return [];
}

/** Rule 4: heading tokens never run into body text (uppercase token not followed by lowercase). */
function ruleNoHeadingBodyFusion(text: string, headings: string[]): string[] {
  const findings: string[] = [];
  for (const h of headings) {
    const bad = new RegExp(`${h.toUpperCase()}[a-z]`);
    if (bad.test(text)) {
      findings.push(`heading-fusion: ${h.toUpperCase()} fused with lowercase body`);
    }
  }
  return findings;
}

const HEADINGS_IN_FIXTURE = ['Summary', 'Experience', 'Skills', 'Education'];

// ---------- helper: render + extract once per positive case ----------

async function extract(props: ResumePdfProps): Promise<string> {
  const buf = await renderResumePdf(props);
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });
  return text;
}

// ---------- per-rule tests ----------

describe('ATS lint rules', () => {
  it('rule: consistent-bullet-glyph - clean fixture passes, mixed-glyph text fails', async () => {
    const text = await extract(SAMPLE_RESUME);
    expect(ruleConsistentBulletGlyph(text, allBullets(SAMPLE_RESUME).length)).toEqual([]);

    const badText = ['- first bullet', '• second bullet', '– third bullet'].join('\n');
    const findings = ruleConsistentBulletGlyph(badText, 3);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join(' ')).toMatch(/bullet-glyph/);
  });

  it('rule: no-fraction-page-numbers - clean fixture passes, fraction glyph + N/M line fail', async () => {
    const text = await extract(SAMPLE_RESUME);
    expect(ruleNoFractionPageNumbers(text)).toEqual([]);

    expect(ruleNoFractionPageNumbers('revenue grew by ½ year over year')).toEqual([
      'fraction-glyph: unicode fraction character present',
    ]);
    expect(ruleNoFractionPageNumbers('body text\n1 / 2\nmore text')).toEqual([
      'page-number: standalone N/M pagination line present',
    ]);
  });

  it('rule: no-zero-width-artifacts - clean fixture passes, ZWSP + BOM + ZWJ texts all fail', async () => {
    const cleanText = await extract(SAMPLE_RESUME);
    expect(ruleNoZeroWidthArtifacts(cleanText)).toEqual([]);

    // ponytail: the react-pdf layout engine scrubs zero-width chars from the
    // output stream (verified: ZWSP/BOM/ZWNJ/ZWJ/WJ in bullet text are all
    // dropped on render). The rule still has to catch them if we ever add a
    // text-level consumer (markdown export, email body, DOCX). So the negative
    // case runs the predicate on crafted text rather than a tainted ResumeDoc.
    expect(ruleNoZeroWidthArtifacts('clean line\nbad​text with ZWSP\n')).toEqual([
      'zero-width: BOM/ZWSP/ZWNJ/ZWJ/word-joiner present',
    ]);
    expect(ruleNoZeroWidthArtifacts('﻿leading BOM')).toHaveLength(1);
    expect(ruleNoZeroWidthArtifacts('joiner‍char')).toHaveLength(1);
  });

  it('rule: no-heading-body-fusion - clean fixture passes, fused heading fails', async () => {
    const text = await extract(SAMPLE_RESUME);
    expect(ruleNoHeadingBodyFusion(text, HEADINGS_IN_FIXTURE)).toEqual([]);

    const badText = 'EXPERIENCEled migration of billing service.\nOther line.';
    const findings = ruleNoHeadingBodyFusion(badText, HEADINGS_IN_FIXTURE);
    expect(findings.length).toBe(1);
    expect(findings[0]).toMatch(/heading-fusion.*EXPERIENCE/);
  });
});

// ---------- sanity sweep ----------

describe('ATS lint rules sanity', () => {
  it('clean fixture returns zero findings across every rule', async () => {
    const text = await extract(SAMPLE_RESUME);
    const all = [
      ...ruleConsistentBulletGlyph(text, allBullets(SAMPLE_RESUME).length),
      ...ruleNoFractionPageNumbers(text),
      ...ruleNoZeroWidthArtifacts(text),
      ...ruleNoHeadingBodyFusion(text, HEADINGS_IN_FIXTURE),
    ];
    expect(all).toEqual([]);
  });
});
