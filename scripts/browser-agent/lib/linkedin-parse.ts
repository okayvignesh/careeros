/**
 * Pure HTML → RawJob parser for LinkedIn job cards (D.5).
 *
 * Zero Playwright dep, zero I/O, zero timers. Given a job-card HTML fragment
 * it returns a `RawJob` object matching @careeros/job-pipeline's `RawJob`
 * shape, or `null` when the fragment is unusable (missing title, missing
 * canonical URL, broken markup, etc.).
 *
 * Kept pure so the fixture tests can hammer it without spinning a browser.
 */

import { load, type CheerioAPI } from 'cheerio';
import { SELECTORS } from './linkedin-selectors.js';

/**
 * Local copy of @careeros/job-pipeline `RawJob` — narrow subset so this
 * module has no workspace dep. When D.6/D.7 wire the discover script into
 * the pipeline, the shape lines up 1:1 with `RawJobSchema.parse()`.
 * ponytail: duplicate 11-field type instead of pulling job-pipeline into
 * scripts/. Swap for a direct import when the discover script is wired.
 */
export interface RawJob {
  sourceId: string;
  sourceName: 'linkedin';
  canonicalUrl: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  description: string;
  sourcePostedAt: Date | null;
  fetchedAt: Date;
  payload: Record<string, unknown>;
}

/** Grab first non-empty match from a comma-separated selector list. */
function pick($: CheerioAPI, selector: string): string | null {
  const raw = $(selector).first().text();
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Extract LinkedIn's numeric job id from a canonical URL. */
function extractJobId(url: string): string | null {
  // Both /jobs/view/<id>/ and /jobs/collections/...?currentJobId=<id> shapes.
  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch?.[1]) return viewMatch[1];
  const paramMatch = url.match(/[?&]currentJobId=(\d+)/);
  if (paramMatch?.[1]) return paramMatch[1];
  return null;
}

/** Best-effort relative-date → Date. LinkedIn uses "2 days ago", "1 week ago". */
function parsePostedAt(raw: string | null, now: Date): Date | null {
  if (!raw) return null;
  // datetime attribute (ISO) wins.
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const d = new Date(iso[0]);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const rel = raw.toLowerCase().match(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/);
  if (!rel) return null;
  const n = Number(rel[1]);
  const unit = rel[2];
  const ms: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_629_800_000,
  };
  const delta = ms[unit];
  if (!delta || !Number.isFinite(n)) return null;
  return new Date(now.getTime() - n * delta);
}

/**
 * Parse a single job-card HTML fragment.
 *
 * Returns `null` when required fields (title, company, canonical URL) are
 * missing or the HTML is unparseable — callers should treat that as a
 * dropped row, NOT an error. Broken markup is expected in the wild.
 */
export function parseJobCard(html: string, now: Date = new Date()): RawJob | null {
  if (!html || typeof html !== 'string') return null;

  let $: CheerioAPI;
  try {
    $ = load(html);
  } catch {
    return null;
  }

  // Anchor: the parser accepts either a bare card fragment or a full page,
  // so we scope to the first jobCard we find. When the fragment IS the card
  // (root element matches), cheerio still resolves this correctly.
  const card = $(SELECTORS.jobCard).first();
  const $scope = card.length > 0 ? card : $.root();

  // Canonical URL — required. Href may be relative; resolve against linkedin.com.
  const hrefRaw = $scope.find(SELECTORS.jobLink).first().attr('href') ?? null;
  if (!hrefRaw) return null;
  const canonicalUrl = hrefRaw.startsWith('http')
    ? hrefRaw
    : `https://www.linkedin.com${hrefRaw.startsWith('/') ? '' : '/'}${hrefRaw}`;

  const jobId = extractJobId(canonicalUrl);
  if (!jobId) return null;

  const title = pickWithin($scope, $, SELECTORS.jobTitle);
  const company = pickWithin($scope, $, SELECTORS.company);
  if (!title || !company) return null;

  const locationRaw = pickWithin($scope, $, SELECTORS.location);
  const remote = locationRaw ? /remote/i.test(locationRaw) : false;

  // postedAt: prefer datetime attribute on <time>, fall back to visible text.
  const timeEl = $scope.find(SELECTORS.postedAt).first();
  const datetimeAttr = timeEl.attr('datetime');
  const postedRaw = datetimeAttr ?? timeEl.text() ?? null;
  const sourcePostedAt = parsePostedAt(postedRaw, now);

  const easyApply = $scope.find(SELECTORS.easyApplyBadge).length > 0;
  const promoted = $scope.find(SELECTORS.promotedBadge).length > 0;
  const expired = $scope.find(SELECTORS.expiredBadge).length > 0;

  // description: cards don't carry the full JD, just the snippet the search
  // page shows. Full description lives on the /jobs/view page (fetched by a
  // separate script). Populate with whatever the card has so pipeline
  // dedupe still gets non-empty text.
  const description = $scope.text().replace(/\s+/g, ' ').trim().slice(0, 5000) || title;

  return {
    sourceId: `linkedin:${jobId}`,
    sourceName: 'linkedin',
    canonicalUrl,
    title,
    company,
    location: locationRaw,
    remote,
    description,
    sourcePostedAt,
    fetchedAt: now,
    payload: { jobId, easyApply, promoted, expired, postedRaw },
  };
}

/**
 * cheerio scoping helper — searches within the card first, falls back to
 * the whole document (fixtures sometimes hand us the card as root).
 */
function pickWithin(
  scope: ReturnType<CheerioAPI>,
  $: CheerioAPI,
  selector: string,
): string | null {
  const scoped = scope.find(selector).first().text();
  const local = scoped.replace(/\s+/g, ' ').trim();
  if (local.length > 0) return local;
  return pick($, selector);
}
