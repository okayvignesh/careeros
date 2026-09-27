import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderResumeDocx } from './docx';
import { templates } from './templates';
import { SAMPLE_RESUME, allBullets, allHeadings } from './__fixtures__/sample-resume';
import type { TemplateId } from './types';

/**
 * C-P4.2 DOCX renderer tests. Mirrors B-9's PDF test in shape:
 *   1. Magic bytes on the buffer (PK\x03\x04 zip header).
 *   2. Content-stable snapshot after masking volatile fields (docx bakes a
 *      created/modified date into `docProps/core.xml`).
 *   3. JSZip round-trip: unzip the .docx, read `word/document.xml`, assert
 *      every heading + every bullet text appears in the XML.
 *   4. Per-template smoke: renders, hits the zip magic, byte-size sane.
 */

const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

/** Read the concatenated text of every `w:t` node in `word/document.xml`. */
async function readDocumentText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing from docx');
  const xml = await entry.async('string');
  const matches = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
  return matches.map((m) => m[1]).join('\n');
}

/** Strip docx timestamps from Core props XML so a content diff still fails. */
async function maskVolatileDocxBytes(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];
  const names = Object.keys(zip.files).sort();
  for (const name of names) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    const raw = await entry.async('string');
    const masked = raw.replace(
      /(<dcterms:(?:created|modified)[^>]*>)[^<]+(<\/dcterms:(?:created|modified)>)/g,
      '$1<MASKED_TS>$2',
    );
    parts.push(name + '\n' + masked);
  }
  return parts.join('\n---\n');
}

describe('renderResumeDocx', () => {
  it('returns a Buffer that starts with the PK zip magic bytes', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).equals(DOCX_MAGIC)).toBe(true);
  });

  it('produces byte-stable output for a fixed model (after masking timestamps)', async () => {
    const a = await maskVolatileDocxBytes(await renderResumeDocx(SAMPLE_RESUME));
    const b = await maskVolatileDocxBytes(await renderResumeDocx(SAMPLE_RESUME));
    expect(a).toBe(b);
    const tampered = await maskVolatileDocxBytes(
      await renderResumeDocx({
        ...SAMPLE_RESUME,
        content: {
          ...SAMPLE_RESUME.content,
          summary: SAMPLE_RESUME.content.summary + ' (tampered)',
        },
      }),
    );
    expect(tampered).not.toBe(a);
  });

  it('unzips to a valid Word package with word/document.xml + Content_Types', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('_rels/.rels')).not.toBeNull();
  });

  it('contains every section heading (uppercased for classic) in document.xml', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME);
    const text = await readDocumentText(buf);
    for (const h of allHeadings(SAMPLE_RESUME)) {
      expect(text).toContain(h.toUpperCase());
    }
  });

  it('contains every bullet from the source model in document.xml', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME);
    const text = await readDocumentText(buf);
    for (const b of allBullets(SAMPLE_RESUME)) {
      expect(text).toContain(b);
    }
  });

  it('contains the role target and jobCompany line', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME);
    const text = await readDocumentText(buf);
    expect(text).toContain(SAMPLE_RESUME.roleTarget);
    expect(text).toContain('Tailored for ' + SAMPLE_RESUME.jobCompany);
  });

  it('throws on unknown template id', async () => {
    await expect(
      renderResumeDocx(SAMPLE_RESUME, { template: 'not-a-template' as TemplateId }),
    ).rejects.toThrow(/Unknown template/);
  });
});

describe('renderResumeDocx per-template', () => {
  const ids: TemplateId[] = ['classic', 'dense-tech', 'modern-minimal'];
  for (const id of ids) {
    it('template=' + id + ' renders a valid docx with all bullets', async () => {
      const buf = await renderResumeDocx(SAMPLE_RESUME, { template: id });
      expect(buf.slice(0, 4).equals(DOCX_MAGIC)).toBe(true);
      expect(buf.length).toBeGreaterThan(5_000);
      expect(buf.length).toBeLessThan(500_000);
      const text = await readDocumentText(buf);
      for (const b of allBullets(SAMPLE_RESUME)) {
        expect(text).toContain(b);
      }
      expect(templates[id]).toBeDefined();
      expect(templates[id].id).toBe(id);
    });
  }

  it('modern-minimal preserves original heading case (does NOT uppercase)', async () => {
    const buf = await renderResumeDocx(SAMPLE_RESUME, { template: 'modern-minimal' });
    const text = await readDocumentText(buf);
    for (const h of allHeadings(SAMPLE_RESUME)) {
      expect(text).toContain(h);
    }
    expect(text).not.toContain('SUMMARY');
  });
});
