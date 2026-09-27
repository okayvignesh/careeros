// LinkedIn job-alert parser. LinkedIn alert HTML uses a repeating card block
// where each posting has:
//   - anchor to a comm.linkedin.com redirect wrapping the real job URL
//   - title text inside the anchor (or a nested strong/span)
//   - a following sibling / nested row with the company name + location line
//     (comma-separated: "Acme, Inc. - Berlin, Germany")
//   - an optional "posted N days ago" line
//
// This parser walks every `<a href>` that points at `linkedin.com/comm/jobs/`
// or `linkedin.com/jobs/view/`, treats it as a job card, and pulls the closest
// title + surrounding text for company/location/postedAt. Anchors that repeat
// (LinkedIn wraps the same job in title + "Apply" links) are deduped by URL.
//
// ponytail: no LLM. Layout drift is the ceiling here; upgrade path is
// "fall back to LLM extraction if `jobs.length === 0` after parse", which the
// consumer service is responsible for.
import * as cheerio from 'cheerio';
import type { EmailJob } from '../types';
import { canonicalJobUrl, cleanText, resolvePostedAt } from './util';

const JOB_HREF_RE = /linkedin\.com\/(?:comm\/)?jobs\/view\//i;

export function parseLinkedin(html: string, receivedAt: Date): EmailJob[] {
  if (!html) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const jobs: EmailJob[] = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    if (!JOB_HREF_RE.test(raw)) return;
    const url = canonicalJobUrl(raw);
    if (!url || seen.has(url)) return;
    const title = cleanText($(el).text());
    if (!title) return;
    seen.add(url);
    // Company/location: LinkedIn puts them in the parent <table>/<td> siblings.
    // Walk up to the containing row and pull the first non-title text nodes.
    const row = $(el).closest('tr, table, td');
    const rowText = cleanText(row.text()).replace(title, '').trim();
    const { company, location } = splitCompanyLocation(rowText);
    const snippet = rowText.length > 0 ? rowText.slice(0, 500) : null;
    const postedAt = resolvePostedAt(rowText, receivedAt);
    jobs.push({ title, company, location, url, snippet, postedAt });
  });
  return jobs;
}

/**
 * LinkedIn's row text often reads `"Acme, Inc. · Berlin, Germany · 2 days ago"`
 * or `"Acme - Berlin"`. Split on the first middle-dot / en-dash / hyphen with
 * spaces; fall back to a comma. Anything after the first split is location.
 */
function splitCompanyLocation(text: string): {
  company: string | null;
  location: string | null;
} {
  if (!text) return { company: null, location: null };
  const parts = text.split(/\s+[·\-]\s+/, 3);
  const company = parts[0]?.trim() || null;
  const location = parts[1]?.trim() || null;
  return { company, location };
}
