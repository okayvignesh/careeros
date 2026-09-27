// Shared helpers for the three parsers. Kept tiny — everything here is a
// one-liner or a small string cleanup so we don't grow a mini-framework.

const WHITESPACE_RE = /\s+/g;
const RELATIVE_RE = /(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i;

/** Collapse whitespace + strip leading/trailing junk from parsed text. */
export function cleanText(raw: string): string {
  return (raw ?? '').replace(WHITESPACE_RE, ' ').trim();
}

/**
 * Normalise a job URL: strip UTM/tracking query params, drop trailing slash.
 * Best-effort — if `new URL()` throws (relative URL, mailto:), return the
 * original string so the parser can still dedupe on raw equality.
 */
export function canonicalJobUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    // Keep the small set of query params that identify the job on each vendor;
    // strip everything else (utm_*, trk, refId, ...).
    const KEEP = new Set(['jk', 'id', 'jobId', 'currentJobId']);
    const kept: Array<[string, string]> = [];
    u.searchParams.forEach((v, k) => {
      if (KEEP.has(k)) kept.push([k, v]);
    });
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    u.hash = '';
    let str = u.toString();
    if (str.endsWith('/')) str = str.slice(0, -1);
    return str;
  } catch {
    return trimmed;
  }
}

/**
 * Resolve a relative "posted N units ago" phrase against `receivedAt`. Returns
 * null when no phrase found or unit unrecognised. Alert mails almost never
 * include an absolute date in the card, so we don't try harder than this.
 */
export function resolvePostedAt(text: string, receivedAt: Date): Date | null {
  const m = text.match(RELATIVE_RE);
  if (!m || !m[1] || !m[2]) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  const ms = unitToMs(unit);
  if (ms === null) return null;
  return new Date(receivedAt.getTime() - n * ms);
}

function unitToMs(unit: string): number | null {
  switch (unit) {
    case 'minute':
      return 60_000;
    case 'hour':
      return 3_600_000;
    case 'day':
      return 86_400_000;
    case 'week':
      return 604_800_000;
    case 'month':
      // Rough — good enough for a "posted about a month ago" tag.
      // ponytail: this exists; upgrade to calendar-month arithmetic when the
      // freshness gate cares about the extra 1-2 days.
      return 30 * 86_400_000;
    default:
      return null;
  }
}
