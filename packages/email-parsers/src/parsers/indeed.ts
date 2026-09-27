// Indeed job-alert parser. Indeed alert mails wrap every posting in a
// `<a href="https://www.indeed.com/rc/clk?jk=...">` link (`jk` = job key).
// Alongside the anchor sits the company name (`.company` in some templates,
// plain sibling text in others) and a `<div>` with the JD snippet.
//
// Strategy: for every `a[href]` matching an Indeed job URL, use the enclosing
// table row / div as the container, split its text into title / company /
// location / snippet. Dedup by canonical `jk=` key so repeated "Apply now"
// buttons don't produce phantom rows.
import * as cheerio from 'cheerio';
import type { EmailJob } from '../types';
import { canonicalJobUrl, cleanText, resolvePostedAt } from './util';

const INDEED_HREF_RE = /indeed\.com\/(?:rc\/clk|viewjob|pagead\/clk)/i;
const JK_RE = /[?&]jk=([A-Za-z0-9]+)/;

export function parseIndeed(html: string, receivedAt: Date): EmailJob[] {
  if (!html) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }
  const seenKeys = new Set<string>();
  const jobs: EmailJob[] = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    if (!INDEED_HREF_RE.test(raw)) return;
    const url = canonicalJobUrl(raw);
    if (!url) return;
    const key = (raw.match(JK_RE)?.[1] ?? url).toLowerCase();
    if (seenKeys.has(key)) return;
    const title = cleanText($(el).text());
    if (!title) return;
    seenKeys.add(key);
    const row = $(el).closest('tr, table, td, div');
    const rowText = cleanText(row.text()).replace(title, '').trim();
    const { company, location } = splitCompanyLocation(rowText);
    const snippet = rowText.length > 0 ? rowText.slice(0, 500) : null;
    const postedAt = resolvePostedAt(rowText, receivedAt);
    jobs.push({ title, company, location, url, snippet, postedAt });
  });
  return jobs;
}

function splitCompanyLocation(text: string): {
  company: string | null;
  location: string | null;
} {
  if (!text) return { company: null, location: null };
  // Indeed mails typically read "Acme Corp - Remote" or "Acme Corp\nRemote".
  // Try dash-with-spaces first (most templates), then a bare newline.
  const dashed = text.split(/\s+-\s+/, 3);
  if (dashed.length >= 2) {
    return {
      company: dashed[0]?.trim() || null,
      location: dashed[1]?.trim() || null,
    };
  }
  const lined = text.split(/\n+/, 3);
  return {
    company: lined[0]?.trim() || null,
    location: lined[1]?.trim() || null,
  };
}
