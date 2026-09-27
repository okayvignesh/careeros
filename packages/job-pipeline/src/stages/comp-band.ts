import type { CompBand } from '../fx/rates';

/**
 * Parse free-form salary text into a structured band. Returns `null` if no
 * confident band could be extracted; callers should treat that as "unknown"
 * rather than fabricating a range.
 *
 * ponytail: regex + heuristic, not an LLM. Job boards emit maybe a dozen
 * common shapes; this covers them and refuses everything else. When a source
 * ships something novel, add a fixture to comp-band.test.ts and extend here.
 * Upgrade path: `job-comp-extract` prompt in packages/ai/prompts/ once the
 * refusal rate on real data crosses ~15%.
 *
 * Recognised shapes (all case-insensitive, whitespace-flexible):
 *   $150k - $200k
 *   $150,000-$200,000/yr
 *   USD 150000 per year
 *   120K CAD
 *   €90k-120k
 *   £45,000 to £60,000
 *   ₹40L - ₹60L        (Indian lakh: 1L = 100_000)
 *   ₹1.2Cr             (Indian crore: 1Cr = 10_000_000)
 *   $80/hr, €35 per hour
 *   $8000/month
 *   80000               (bare number: refused — no currency signal)
 */

// Currency symbol → ISO code. Only the ones we can actually convert (see rates.json).
const SYMBOL_TO_CODE: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₽': 'RUB',
  '₩': 'KRW',
  '₺': 'TRY',
  '₪': 'ILS',
};

// ISO code aliases that appear in job text but aren't the canonical 3-letter form.
const CODE_ALIASES: Record<string, string> = {
  RS: 'INR',
  RS_: 'INR',
  YEN: 'JPY',
  RMB: 'CNY',
  KR: 'SEK', // ponytail: SEK/NOK/DKK all use "kr"; SEK wins as the largest market. Fix when a real miss shows up.
};

// Recognised ISO codes (whatever we have FX for).
const KNOWN_CODES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'INR', 'SGD',
  'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'ILS', 'ZAR', 'BRL', 'MXN', 'RUB',
  'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'TRY', 'AED', 'SAR',
]);

type Period = 'hour' | 'month' | 'year';

function detectPeriod(text: string): Period {
  const t = text.toLowerCase();
  if (/\b(hour|hr|\/h|per\s*hour|hourly)\b|\/hr\b/.test(t)) return 'hour';
  if (/\b(month|mo|\/mo|per\s*month|monthly)\b/.test(t)) return 'month';
  return 'year';
}

function detectCurrency(text: string): string | null {
  // Symbol first — sits directly on numbers ($150k).
  for (const sym of Object.keys(SYMBOL_TO_CODE)) {
    if (text.includes(sym)) return SYMBOL_TO_CODE[sym]!;
  }
  // ISO code as a whole word.
  const upper = text.toUpperCase();
  for (const code of KNOWN_CODES) {
    // \b works on ASCII; codes are ASCII.
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  for (const alias of Object.keys(CODE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(upper)) return CODE_ALIASES[alias]!;
  }
  return null;
}

/**
 * Parse a single numeric token with optional k/m/l/cr suffix into a number.
 * `150k` → 150000, `1.2m` → 1_200_000, `40L` → 4_000_000 (lakh),
 * `1.2Cr` → 12_000_000 (crore), `150,000` → 150000.
 * Returns null if not a valid number.
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(k|m|l|cr)?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = m[2]?.toLowerCase();
  switch (suffix) {
    case 'k': return base * 1_000;
    case 'm': return base * 1_000_000;
    case 'l': return base * 100_000;      // Indian lakh
    case 'cr': return base * 10_000_000;   // Indian crore
    default: return base;
  }
}

/**
 * Extract every number-with-suffix token from a string, in order.
 * Order matters for pairing into min/max.
 */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?\s*(?:cr|k|m|l)?/gi) ?? [];
  const nums: number[] = [];
  for (const m of matches) {
    const n = parseNumber(m);
    if (n !== null && n > 0) nums.push(n);
  }
  return nums;
}

export function parseCompBand(input: string | null | undefined): CompBand | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  const currency = detectCurrency(text);
  if (!currency) return null;

  const nums = extractNumbers(text);
  if (nums.length === 0) return null;

  const period = detectPeriod(text);

  let min: number;
  let max: number;
  if (nums.length === 1) {
    // Single value: treat as both min and max — "makes X" or "$150K/yr".
    min = nums[0]!;
    max = nums[0]!;
  } else {
    // Two-or-more: first pair is the range. Ignore later noise like "+equity".
    min = Math.min(nums[0]!, nums[1]!);
    max = Math.max(nums[0]!, nums[1]!);
  }

  // Sanity: refuse degenerate bands (negative, or hourly > $10k/hr, or yearly < $1k).
  if (min <= 0 || max <= 0) return null;
  if (period === 'year' && max < 1_000) return null;
  if (period === 'hour' && max > 10_000) return null;

  return { min, max, currency, period };
}
