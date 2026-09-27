/**
 * `classic` - safe, dense-enough single-column layout. This is the ATS
 * baseline: identical PDF output to what shipped as `ats-first` (Wave B B-9
 * snapshot depends on it - we delegate to the same React component to
 * guarantee byte-stability).
 *
 * ponytail: reuses `AtsFirstResume` verbatim. Duplicating the JSX just to
 * get a fresh filename would risk drift between the snapshot and the
 * template registry.
 */
import { AtsFirstResume } from './ats-first';
import { buildResumeDocument } from '../docx';
import type { Template } from '../types';

export const classic: Template = {
  id: 'classic',
  name: 'Classic',
  description: 'Single-column, Helvetica, uppercase section headings with rule. Safest ATS bet.',
  renderPdf: (doc) => AtsFirstResume(doc),
  renderDocx: (doc) =>
    buildResumeDocument(doc, {
      bodyFont: 'Calibri',
      headingFont: 'Calibri',
      uppercaseHeadings: true,
    }),
};
