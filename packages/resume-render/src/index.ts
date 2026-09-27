import { renderToBuffer } from '@react-pdf/renderer';
import {
  AtsFirstCoverLetter,
  AtsFirstResume,
  type CoverLetterPdfProps,
  type ResumePdfProps,
} from './templates/ats-first';

/**
 * Server-side render helpers. Both return a Node `Buffer` suitable for
 * streaming as `application/pdf`. `renderToBuffer` is React-PDF's canonical
 * server API — no DOM required.
 */

export async function renderResumePdf(props: ResumePdfProps): Promise<Buffer> {
  return await renderToBuffer(AtsFirstResume(props));
}

export async function renderCoverLetterPdf(props: CoverLetterPdfProps): Promise<Buffer> {
  return await renderToBuffer(AtsFirstCoverLetter(props));
}

export { AtsFirstResume, AtsFirstCoverLetter };
export type { ResumePdfProps, CoverLetterPdfProps };
