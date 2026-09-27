// Naukri job-alert parser. Naukri alert mails render each posting as a table
// row where the title anchor points at `naukri.com/job-listings-...` (SEO
// slug URL) or `nma.naukri.com/dem/mail/...` (redirect wrapper). Company +
// location + experience + salary live in the same `<td>` as plain text lines.
//
// ponytail: strip Naukri's `redirect?url=` wrapper when present so the parsed
// URL is stable across mail campaigns.
import * as cheerio from 'cheerio';
import type { EmailJob } from '../types';
import { canonicalJobUrl, cleanText, resolvePostedAt } from './util';

const NAUKRI_HREF_RE =
  /naukri\.com\/(?:job-listings|jd|company)|nma\.naukri\.com\/(?:dem|jobapi)/i;

export function parseNaukri(html: string, receivedAt: Date): EmailJob[] {
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
    if (!NAUKRI_HREF_RE.test(raw)) return;
    const url = canonicalJobUrl(unwrapNaukriRedirect(raw));
    if (!url || seen.has(url)) return;
    const title = cleanText($(el).text());
    if (!title) return;
    seen.add(url);
    const row = $(el).closest('tr, table, td, div');
    const rowText = cleanText(row.text()).replace(title, '').trim();
    const { company, location } = splitCompanyLocation(rowText);
    const snippet = rowText.length > 0 ? rowText.slice(0, 500) : null;
    const postedAt = resolvePostedAt(rowText, receivedAt);
    jobs.push({ title, company, location, url, snippet, postedAt });
  });
  return jobs;
}

function unwrapNaukriRedirect(raw: string): string {
  // Naukri's tracker wraps the real URL as `?url=<encoded>` or `?dest=`.
  const m = raw.match(/[?&](?:url|dest)=([^&]+)/);
  if (!m || !m[1]) return raw;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return raw;
  }
}

function splitCompanyLocation(text: string): {
  company: string | null;
  location: string | null;
} {
  if (!text) return { company: null, location: null };
  // Naukri lines: "Acme Technologies | Bengaluru | 3-6 Yrs | ...".
  // Pipe is the canonical separator; fall back to hyphen.
  const piped = text.split(/\s*\|\s*/, 4);
  if (piped.length >= 2) {
    return {
      company: piped[0]?.trim() || null,
      location: piped[1]?.trim() || null,
    };
  }
  const dashed = text.split(/\s+-\s+/, 3);
  return {
    company: dashed[0]?.trim() || null,
    location: dashed[1]?.trim() || null,
  };
}
