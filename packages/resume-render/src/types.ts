/**
 * Unified content model consumed by every renderer (PDF today, DOCX added in
 * C-P4.2, potentially plain-text next). Kept intentionally narrow: a resume is
 * a header (role + optional company target) plus a summary plus ordered
 * sections of bullets. Everything richer (skill clusters, project links, etc.)
 * lives INSIDE bullet text — templates lay it out, they do not restructure it.
 *
 * Every contact field is optional and only ever populated from VERIFIED
 * `resume_facts` (AGENTS §2 — never invent facts). A template may omit the
 * whole block; region-aware templates render only the fields that exist. There
 * is deliberately no address synthesis: `location` is whatever the verified
 * location fact literally said.
 */

/** Ordered section of bulleted content — Experience, Skills, Education, etc. */
export interface ResumeSection {
  heading: string;
  bullets: Array<{ text: string }>;
}

/**
 * Contact/location header fields. All optional; a missing field is rendered as
 * nothing (never a placeholder address). Sourced only from verified facts:
 * `location`/`headline` from `resume_facts` of those kinds, identity fields
 * from a `contact`/`personal` fact when one exists.
 */
export interface ResumeContact {
  name?: string;
  email?: string;
  location?: string;
  headline?: string;
}

/**
 * Unified resume shape. This is the ONLY input every template consumes; the
 * old `ResumePdfProps` (still exported from `templates/ats-first`) is now a
 * structural alias of this so all existing callers keep compiling.
 */
export interface ResumeDoc {
  roleTarget: string;
  jobCompany: string | null;
  /** Optional verified contact/location block. Absent for legacy callers. */
  contact?: ResumeContact;
  content: {
    summary: string;
    sections: ResumeSection[];
  };
}

/** Registered templates. Adding a template means adding a key here + entry in `templates/index.ts`. */
export type TemplateId = 'classic' | 'dense-tech' | 'modern-minimal' | 'international';

/** Every template exposes the same 4-field shape. Registry + renderers depend on this. */
export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  /** Returns a React element for `@react-pdf/renderer`'s `renderToBuffer`. */
  renderPdf: (doc: ResumeDoc) => import('react').ReactElement;
  /** Returns a docx `Document` ready to hand to `Packer.toBuffer`. */
  renderDocx: (doc: ResumeDoc) => import('docx').Document;
}
