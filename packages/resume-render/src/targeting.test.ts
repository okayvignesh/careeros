import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  RESUME_REGION_TEMPLATE_MAP,
  RESUME_TEMPLATE_IDS,
  normalizeTemplateId,
  parseTemplateId,
  regionToTemplate,
} from './targeting';
import { renderResumePdfByTemplate } from './index';
import { SAMPLE_RESUME } from './__fixtures__/sample-resume';

/**
 * Deterministic region → template selection + legacy-id normalization.
 * Selection is code-only (job-targeting-design.md §9); these tests pin the
 * closed vocabulary so an LLM can never influence the layout choice.
 */

describe('regionToTemplate', () => {
  it('maps every shared region to a registered template id', () => {
    for (const [region, template] of Object.entries(RESUME_REGION_TEMPLATE_MAP)) {
      expect(RESUME_TEMPLATE_IDS).toContain(template);
      expect(regionToTemplate(region)).toBe(template);
    }
  });

  it('north america keeps the LETTER ATS baseline; all other regions go A4 international', () => {
    expect(regionToTemplate('north_america')).toBe('classic');
    for (const region of ['south_america', 'europe', 'africa', 'middle_east', 'asia_pacific']) {
      expect(regionToTemplate(region)).toBe('international');
    }
  });

  it('unknown / absent region falls back to the ATS baseline (never throws)', () => {
    expect(regionToTemplate(null)).toBe('classic');
    expect(regionToTemplate(undefined)).toBe('classic');
    expect(regionToTemplate('atlantis')).toBe('classic');
  });
});

describe('template id normalization', () => {
  it('parses legacy DB defaults (ats-first / standard) to canonical ids', () => {
    expect(parseTemplateId('ats-first')).toBe('classic');
    expect(parseTemplateId('standard')).toBe('classic');
    expect(parseTemplateId('default')).toBe('classic');
    expect(parseTemplateId('classic')).toBe('classic');
    expect(parseTemplateId('international')).toBe('international');
    expect(parseTemplateId('europass')).toBe('international');
  });

  it('returns null for unknown ids and null/undefined input', () => {
    expect(parseTemplateId('not-a-template')).toBeNull();
    expect(parseTemplateId(null)).toBeNull();
    expect(parseTemplateId(undefined)).toBeNull();
  });

  it('normalizeTemplateId falls back to classic only for unknown/absent', () => {
    expect(normalizeTemplateId('ats-first')).toBe('classic');
    expect(normalizeTemplateId('not-a-template')).toBe('classic');
    expect(normalizeTemplateId(null)).toBe('classic');
  });
});

describe('renderResumePdfByTemplate', () => {
  it('renders the legacy `ats-first` id instead of throwing (DB default bridge)', async () => {
    const buf = await renderResumePdfByTemplate(SAMPLE_RESUME, { template: 'ats-first' });
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('still throws on a genuinely unknown template id', async () => {
    await expect(
      renderResumePdfByTemplate(SAMPLE_RESUME, { template: 'not-a-template' }),
    ).rejects.toThrow(/Unknown template/);
  });

  it('international template carries the verified contact block', async () => {
    const buf = await renderResumePdfByTemplate(
      { ...SAMPLE_RESUME, contact: { location: 'Berlin, Germany' } },
      { template: 'international' },
    );
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    const proxy = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(proxy, { mergePages: true });
    expect(text).toContain('Berlin, Germany');
    // A4-only title marker: the classic LETTER template must NOT pick it up.
    const classic = await renderResumePdfByTemplate(
      { ...SAMPLE_RESUME, contact: { location: 'Berlin, Germany' } },
      { template: 'classic' },
    );
    const classicProxy = await getDocumentProxy(new Uint8Array(classic));
    const classicText = (await extractText(classicProxy, { mergePages: true })).text;
    expect(classicText).not.toContain('Berlin, Germany');
    // Mutation smoke: drop the contact block from the template and the first
    // `toContain` fails; render it in every template and the second fails.
  });
});
