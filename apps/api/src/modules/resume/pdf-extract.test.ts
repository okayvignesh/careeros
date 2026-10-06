// A-H7 regression: pdf-parse@1.1.1 (2018) replaced with unpdf. Prove text extraction
// round-trips against a live-rendered PDF so the swap can't silently produce empty output.
//
// P2b: this also exercises `renderResumePdfByTemplate` (the region-aware render
// path both the variant download and the ATS submit now use), including the
// legacy `ats-first` DB default id.
import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderResumePdfByTemplate } from '@careeros/resume-render';

async function extractTextFrom(buf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n');
}

describe('unpdf text extraction (A-H7)', () => {
  it('extracts a known marker string from a rendered resume PDF', async () => {
    const marker = 'CareerOsExtractionSentinel';
    const pdf = await renderResumePdfByTemplate(
      {
        roleTarget: marker,
        jobCompany: null,
        content: {
          summary: `Summary for ${marker}`,
          sections: [{ heading: 'Experience', bullets: [{ text: `Built ${marker} in 2026` }] }],
        },
      },
      { template: 'classic' },
    );

    const joined = await extractTextFrom(pdf);
    expect(joined).toContain(marker);
    expect(joined.length).toBeGreaterThan(marker.length);
  });

  it('renders the legacy `ats-first` DB default id without throwing (P2b normalization)', async () => {
    const marker = 'LegacyTemplateMarker';
    const pdf = await renderResumePdfByTemplate(
      {
        roleTarget: 'SRE',
        jobCompany: null,
        content: {
          summary: marker,
          sections: [{ heading: 'Experience', bullets: [{ text: 'Operated systems.' }] }],
        },
      },
      { template: 'ats-first' },
    );
    const joined = await extractTextFrom(pdf);
    expect(joined).toContain(marker);
  });
});
