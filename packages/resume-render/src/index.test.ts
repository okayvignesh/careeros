import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderResumePdf } from './index';
import { SAMPLE_RESUME, allBullets, allHeadings } from '../__fixtures__/sample-resume';
import type { ResumePdfProps } from './templates/ats-first';

/**
 * B-9. Covers:
 *   1. Magic-byte header on the produced Buffer.
 *   2. Content-stable byte snapshot (PDF has volatile CreationDate + /ID —
 *      mask both, snapshot the rest so a real diff still trips the test).
 *   3. unpdf round-trip (mirrors ResumeService.extractText) — every heading
 *      and every bullet from the source model appears in extracted text.
 *   4. ATS-lint markers — no fraction-glyph page numbers, no invisible-space
 *      artifacts, headings on their own line, bullets prefixed with a single
 *      consistent glyph.
 */

/** Strip PDF timestamps + document IDs so a content diff still fails the snapshot. */
function maskVolatilePdfBytes(buf: Buffer): string {
  return buf
    .toString('latin1')
    .replace(/D:\d{14}[Z0-9+\-']*/g, 'D:<MASKED_TS>')
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, '/ID [<MASKED_ID> <MASKED_ID>]');
}

async function extract(props: ResumePdfProps): Promise<{ buf: Buffer; text: string; pages: number }> {
  const buf = await renderResumePdf(props);
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(proxy, { mergePages: true });
  return { buf, text, pages: totalPages };
}

describe('renderResumePdf', () => {
  it('returns a Buffer that starts with the %PDF- magic bytes', async () => {
    const buf = await renderResumePdf(SAMPLE_RESUME);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(200); // any real PDF; empty output => bug
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    // Mutation smoke: if renderResumePdf ever returned '' or a wrong element,
    // the magic-byte check fails immediately.
  });

  it('produces byte-stable output for a fixed model (after masking timestamp + /ID)', async () => {
    const a = maskVolatilePdfBytes(await renderResumePdf(SAMPLE_RESUME));
    const b = maskVolatilePdfBytes(await renderResumePdf(SAMPLE_RESUME));
    expect(a).toBe(b);
    // Mutation smoke: swap one bullet and the masked bytes must differ.
    const tampered = maskVolatilePdfBytes(
      await renderResumePdf({
        ...SAMPLE_RESUME,
        content: {
          ...SAMPLE_RESUME.content,
          summary: SAMPLE_RESUME.content.summary + ' (tampered)',
        },
      }),
    );
    expect(tampered).not.toBe(a);
  });
});

describe('renderResumePdf unpdf round-trip', () => {
  it('extracted text contains every section heading (uppercased) on its own line', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    for (const h of allHeadings(SAMPLE_RESUME)) {
      // Template applies textTransform: uppercase; react-pdf realises the
      // transform in the text stream. Assert both the uppercased form AND
      // that it stands alone on a line (no header/body run-in that ATS
      // parsers commonly split badly).
      const upper = h.toUpperCase();
      expect(text).toContain(upper);
      const lineRegex = new RegExp(`^${upper}$`, 'm');
      expect(text).toMatch(lineRegex);
    }
    // Mutation smoke: rename a heading and the loop fails on the missing one.
  });

  it('extracted text contains every bullet from the source model', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    for (const b of allBullets(SAMPLE_RESUME)) {
      expect(text).toContain(b);
    }
    // Mutation smoke: drop a bullet from the template and this fails.
  });

  it('reports exactly one page for the sample fixture', async () => {
    const { pages } = await extract(SAMPLE_RESUME);
    expect(pages).toBe(1);
    // Mutation smoke: if the template ever page-breaks unexpectedly, this trips.
  });
});

describe('renderResumePdf ATS-lint markers', () => {
  it('bullets are prefixed with a single, consistent glyph on their own line', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    const bulletLines = text.split('\n').filter((l) => /^[\-•–]/.test(l));
    expect(bulletLines.length).toBe(allBullets(SAMPLE_RESUME).length);
    // Every bullet must use the SAME glyph, else parsers mis-group items.
    const glyphs = new Set(bulletLines.map((l) => l[0]));
    expect(glyphs.size).toBe(1);
    // Mutation smoke: change one bullet's mark in the template and glyphs.size becomes 2.
  });

  it('contains no fraction-glyph page numbers ("1/2", "2 of 2" only if literally present)', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    // These are known-bad artifacts: unicode fraction chars or explicit "N/M" pagination.
    expect(text).not.toMatch(/[¼-¾⅐-⅞]/); // ¼ ½ ¾ ⅐-⅞
    expect(text).not.toMatch(/^\s*\d+\s*\/\s*\d+\s*$/m);
    // Mutation smoke: adding `Page {i}/{n}` footer would trip the second regex.
  });

  it('contains no invisible-space or zero-width artifacts (BOM, ZWSP, ZWNJ, ZWJ, WORD-JOINER)', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    expect(text).not.toMatch(/[﻿​‌‍⁠]/);
    // Mutation smoke: any template that interpolates untrusted text without
    // stripping these markers would trip the assertion.
  });

  it('headings are not fused with body text on the same line (ligature-split guard)', async () => {
    const { text } = await extract(SAMPLE_RESUME);
    // Well-known-good: heading line followed by a distinct non-heading line.
    // Bad shape: `EXPERIENCELed migration...` (missing newline) — assert the
    // heading token is never immediately followed by a lowercase letter.
    for (const h of allHeadings(SAMPLE_RESUME)) {
      const bad = new RegExp(`${h.toUpperCase()}[a-z]`);
      expect(text).not.toMatch(bad);
    }
    // Mutation smoke: dropping the section View wrapper in the template would
    // let headings run into body text and trip the regex.
  });
});
