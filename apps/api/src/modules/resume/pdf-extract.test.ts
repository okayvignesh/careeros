// A-H7 regression: pdf-parse@1.1.1 (2018) replaced with unpdf. Prove text extraction
// round-trips against a live-rendered PDF so the swap can't silently produce empty output.
import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderResumePdf } from '@careeros/resume-render';

describe('unpdf text extraction (A-H7)', () => {
  it('extracts a known marker string from a rendered resume PDF', async () => {
    const marker = 'CareerOsExtractionSentinel';
    const pdf = await renderResumePdf({
      roleTarget: marker,
      jobCompany: null,
      content: {
        summary: `Summary for ${marker}`,
        sections: [{ heading: 'Experience', bullets: [{ text: `Built ${marker} in 2026` }] }],
      },
    });

    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const { text } = await extractText(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const joined = pages.join('\n');

    expect(joined).toContain(marker);
    expect(joined.length).toBeGreaterThan(marker.length);
  });
});
