import { renderToBuffer } from '@react-pdf/renderer';
import {
  AtsFirstCoverLetter,
  AtsFirstResume,
  type CoverLetterPdfProps,
  type ResumePdfProps,
} from './templates/ats-first';
import { templates } from './templates';
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
 * Same as `renderResumePdf` but lets the caller pick a template. Backward-
 * compatible default (`classic`) matches the old byte-stable output.
 */
export async function renderResumePdfByTemplate(
  doc: ResumeDoc,
  opts: { template?: TemplateId } = {},
): Promise<Buffer> {
  const id = opts.template ?? 'classic';
  const tpl = templates[id];
  if (!tpl) throw new Error(`Unknown template: ${id}`);
  return await renderToBuffer(tpl.renderPdf(doc));
}

export { renderResumeDocx } from './docx';
export { templates, templateList } from './templates';
export { AtsFirstResume, AtsFirstCoverLetter };
export type { ResumePdfProps, CoverLetterPdfProps };
export type { ResumeDoc, ResumeSection, TemplateId, Template } from './types';
