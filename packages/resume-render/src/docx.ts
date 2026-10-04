/**
 * DOCX renderer. Every template lands here via its `renderDocx(doc)` which
 * returns a `docx.Document`; we serialize with `Packer.toBuffer`.
 *
 * ATS-friendly by construction: single section, no columns, no headers/
 * footers, no images, plain bullets via `numbering`, standard font (Calibri
 * 11 by default; template can override). Section headings are their own
 * paragraph so parsers don't fuse them with body text.
 *
 * ponytail: single shared paragraph builder per template. Templates pass
 * style knobs, not their own OOXML.
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat, BorderStyle, convertInchesToTwip, type IRunOptions, type IParagraphOptions } from 'docx';
import { templates } from './templates';
import { parseTemplateId } from './targeting';
import type { ResumeDoc, TemplateId } from './types';

/** Style hooks each template can override; sensible ATS-first defaults everywhere. */
export interface DocxTheme {
  /** Body font (Calibri 11 is the .docx v2016 default and reads on every parser). */
  bodyFont?: string;
  /** Heading font — often same as body; separate hook for modern-minimal etc. */
  headingFont?: string;
  /** Body font size in half-points; docx uses half-points. 22 = 11pt. */
  bodyHalfPt?: number;
  /** Heading half-points. */
  headingHalfPt?: number;
  /** Uppercase section headings? classic + dense-tech = true; modern-minimal = false per plan. */
  uppercaseHeadings?: boolean;
  /** Single accent colour (hex, no #). undefined = no accent, black text. */
  accentHex?: string;
  /** Spacing after each bullet, in twentieths of a point. Tighter for dense-tech. */
  bulletSpacingAfter?: number;
}

const DEFAULT_THEME: Required<DocxTheme> = {
  bodyFont: 'Calibri',
  headingFont: 'Calibri',
  bodyHalfPt: 22,
  headingHalfPt: 24,
  uppercaseHeadings: true,
  accentHex: '',
  bulletSpacingAfter: 80,
};

/**
 * Build a `docx.Document` from a ResumeDoc + theme. Every template calls
 * this — that's why per-template code is a five-line theme object, not a
 * new Word document each time.
 */
export function buildResumeDocument(doc: ResumeDoc, theme: DocxTheme = {}): Document {
  const t = { ...DEFAULT_THEME, ...theme };
  const accent = t.accentHex || '';

  const children: Paragraph[] = [];

  // Header: role target + optional "Tailored for {company}".
  const headerRun: IRunOptions = accent
    ? { text: doc.roleTarget, bold: true, size: 32, font: t.headingFont, color: accent }
    : { text: doc.roleTarget, bold: true, size: 32, font: t.headingFont };
  children.push(
    new Paragraph({
      children: [new TextRun(headerRun)],
      spacing: { after: 120 },
    }),
  );
  if (doc.jobCompany) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Tailored for ${doc.jobCompany}`,
            size: 20, // 10pt
            font: t.bodyFont,
            color: '555555',
          }),
        ],
        spacing: { after: 240 },
      }),
    );
  }

  // Verified contact/location line (only fields that exist; never synthesized).
  if (doc.contact) {
    const contactParts = [doc.contact.name, doc.contact.location, doc.contact.email].filter(
      (v): v is string => Boolean(v),
    );
    const contactText = [doc.contact.headline, contactParts.join(' · ')]
      .filter((v): v is string => Boolean(v))
      .join(' — ');
    if (contactText) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: contactText, size: 20, font: t.bodyFont, color: '555555' }),
          ],
          spacing: { after: 240 },
        }),
      );
    }
  }

  // Summary section.
  children.push(sectionHeading('Summary', t));
  children.push(
    new Paragraph({
      children: [new TextRun({ text: doc.content.summary, font: t.bodyFont, size: t.bodyHalfPt })],
      spacing: { after: 160 },
    }),
  );

  // Body sections.
  for (const sec of doc.content.sections) {
    children.push(sectionHeading(sec.heading, t));
    for (const b of sec.bullets) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: b.text, font: t.bodyFont, size: t.bodyHalfPt })],
          numbering: { reference: 'ats-bullets', level: 0 },
          spacing: { after: t.bulletSpacingAfter },
        }),
      );
    }
  }

  return new Document({
    creator: 'Career OS',
    title: `Resume - ${doc.roleTarget}`,
    // ponytail: no per-run created/modified dates in the Core props — docx
    // fills them itself. Test masks them below.
    styles: {
      default: {
        document: { run: { font: t.bodyFont, size: t.bodyHalfPt } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ats-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•', // • — matches the PDF ATS-lint expectation of a single glyph
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.2) } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              right: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.7),
            },
          },
        },
        children,
      },
    ],
  });
}

function sectionHeading(text: string, t: Required<DocxTheme>): Paragraph {
  const shown = t.uppercaseHeadings ? text.toUpperCase() : text;
  const base: IParagraphOptions = {
    children: [
      new TextRun({
        text: shown,
        bold: true,
        size: t.headingHalfPt,
        font: t.headingFont,
        color: t.accentHex || '111111',
      }),
    ],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  };
  const withBorder: IParagraphOptions = t.uppercaseHeadings
    ? { ...base, border: { bottom: { color: '999999', space: 2, style: BorderStyle.SINGLE, size: 6 } } }
    : base;
  return new Paragraph(withBorder);
}

/**
 * Public entry point — mirrors `renderResumePdf`. Returns a Node Buffer
 * suitable for streaming as `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
 */
export async function renderResumeDocx(
  doc: ResumeDoc,
  opts: { template?: TemplateId | string } = {},
): Promise<Buffer> {
  const requested = opts.template;
  const id = requested === undefined ? 'classic' : parseTemplateId(requested);
  if (!id) throw new Error(`Unknown template: ${requested}`);
  const tpl = templates[id];
  const wordDoc = tpl.renderDocx(doc);
  return await Packer.toBuffer(wordDoc);
}
