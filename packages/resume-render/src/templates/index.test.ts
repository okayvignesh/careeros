import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { templates, templateList } from './index';
import { SAMPLE_RESUME } from '../__fixtures__/sample-resume';
import type { TemplateId } from '../types';

/**
 * Template registry contract:
 *   1. All three plan IDs registered.
 *   2. Each entry's `id` matches its key (no accidental copy-paste mixups).
 *   3. Each template's `renderPdf` returns something react-pdf can pack.
 */

describe('template registry', () => {
  const expected: TemplateId[] = ['classic', 'dense-tech', 'modern-minimal', 'international'];

  it('registers all four plan templates', () => {
    expect(Object.keys(templates).sort()).toEqual([...expected].sort());
    expect(templateList).toHaveLength(4);
  });

  it('every entry has id/name/description/renderPdf/renderDocx and id matches its key', () => {
    for (const id of expected) {
      const t = templates[id];
      expect(t.id).toBe(id);
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.renderPdf).toBe('function');
      expect(typeof t.renderDocx).toBe('function');
    }
  });

  it('every template renders a real PDF (starts with %PDF-)', async () => {
    for (const id of expected) {
      const buf = await renderToBuffer(templates[id].renderPdf(SAMPLE_RESUME));
      expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(500);
    }
  });
});
