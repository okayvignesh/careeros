import { renderToBuffer } from '@react-pdf/renderer';
import {
  AtsFirstCoverLetter,
  AtsFirstResume,
  type CoverLetterPdfProps,
  type ResumePdfProps,
} from './templates/ats-first';
import { templates } from './templates';
import { parseTemplateId } from './targeting';
import type { ResumeDoc, TemplateId } from './types';

/**
 * Server-side render helpers. Both return a Node `Buffer` suitable for
 * streaming as `application/pdf`. `renderToBuffer` is React-PDF's canonical
 * server API - no DOM required.
 */

export async function renderResumePdf(props: ResumePdfProps): Promise<Buffer> {
  return await renderToBuffer(AtsFirstResume(props));
}

export async function renderCoverLetterPdf(props: CoverLetterPdfProps): Promise<Buffer> {
  return await renderToBuffer(AtsFirstCoverLetter(props));
}

/**
 * Same as `renderResumePdf` but lets the caller pick a template. Legacy ids
 * (`ats-first`, `standard`, `default`) are normalized to canonical ids so the
 * DB defaults no longer throw; a genuinely unknown id still throws so a typo in
 * a caller isn't silently rendered with the wrong layout.
 */
export async function renderResumePdfByTemplate(
  doc: ResumeDoc,
  opts: { template?: TemplateId | string } = {},
): Promise<Buffer> {
  const requested = opts.template;
  const id = requested === undefined ? 'classic' : parseTemplateId(requested);
  if (!id) throw new Error(`Unknown template: ${requested}`);
  const tpl = templates[id];
  return await renderToBuffer(tpl.renderPdf(doc));
}

export { renderResumeDocx } from './docx';
export { templates, templateList } from './templates';
export { AtsFirstResume, AtsFirstCoverLetter };
export {
  RESUME_TEMPLATE_IDS,
  RESUME_REGION_TEMPLATE_MAP,
  regionToTemplate,
  parseTemplateId,
  normalizeTemplateId,
} from './targeting';
export type { ResumePdfProps, CoverLetterPdfProps };
export type { ResumeDoc, ResumeSection, ResumeContact, TemplateId, Template } from './types';
