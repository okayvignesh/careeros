// Hallucination-suspect heuristic. Given a set of "facts" strings (verbatim source
// content) and a model output object, flag substrings in the output that don't
// appear in any fact. Focused on the four kinds of drift that matter for us:
//   - specific numbers (percentages, counts, years)
//   - dates (yyyy-mm-dd, mm/dd/yyyy, month-year)
//   - proper-noun runs (Capitalised Company + Product names)
//   - currency amounts
//
// This is a heuristic, not a proof. It's fast (regex), zero-provider-call, and
// intended for the eval loop + a warning row in llm_hallucination_log. False
// positives are OK -- the eval suite calibrates thresholds later.

const NUMBER_RE = /-?\b\d{2,}(?:[.,]\d+)?%?\b/g;
const YEAR_RE = /\b(19|20)\d{2}\b/g;
// Word-boundary version of the ISO date so `12024-01-01` doesn't match the tail
// `2024-01-01`. Same for the slash variant.
const DATE_RE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b|(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|(?<!\d)\d{1,2}\/\d{1,2}\/\d{2,4}(?!\d)/gi;
// Currency like `$2`, `$2,000`, `$2.5M`, `1000 USD`. Allow optional K/M/B/T suffix.
// Accept ASCII space, NBSP or narrow NBSP between symbol/amount.
const CURRENCY_RE =
  /(?:[$€£¥][   ]?\d[\d,]*(?:\.\d+)?(?:[kmbt])?)|(?:\b\d[\d,]*(?:\.\d+)?[   ]?(?:usd|eur|gbp|inr|jpy))\b/gi;
// Runs of >=2 Capitalised words. `The Kubernetes cluster` etc. get dropped by the
// article-head filter below so sentence-initial capitals don't fire false positives.
const PROPER_NOUN_RE = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){1,4}\b/g;
const ARTICLE_HEADS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those',
  'His', 'Her', 'Their', 'Our', 'My', 'Your',
  'In', 'On', 'At', 'For', 'With', 'From', 'By',
]);

export interface HallucinationReport {
  suspects: string[];
  byKind: {
    numbers: string[];
    years: string[];
    dates: string[];
    currency: string[];
    properNouns: string[];
  };
}

/**
 * Extract "check-worthy" fragments from any string in the output object graph
 * that don't literally appear in the union of `facts`.
 *
 * Both sides are normalised (NFKC + lowercased + NBSP-collapsed) and a comma-strip
 * pass is tried before flagging so trivial rewrites (`1,000` vs `1000`, fullwidth
 * digits, homoglyphs) don't produce false positives.
 */
export function findHallucinations(
  output: unknown,
  facts: string[],
): HallucinationReport {
  const outputStrings = collectStrings(output);
  const factCorpus = facts.map(normaliseForCompare).join('\n');
  const rawFacts = facts.map((f) => f.normalize('NFKC').toLowerCase()).join('\n');

  const rawProperNouns = unique(matchAll(outputStrings, PROPER_NOUN_RE));
  const filteredProperNouns = rawProperNouns.filter((p) => {
    const head = p.split(/\s+/)[0] ?? '';
    return !ARTICLE_HEADS.has(head);
  });

  const byKind = {
    numbers: unique(matchAll(outputStrings, NUMBER_RE)),
    years: unique(matchAll(outputStrings, YEAR_RE)),
    dates: unique(matchAll(outputStrings, DATE_RE)),
    currency: unique(matchAll(outputStrings, CURRENCY_RE)),
    properNouns: filteredProperNouns,
  };

  const suspects = [
    ...byKind.numbers,
    ...byKind.years,
    ...byKind.dates,
    ...byKind.currency,
    ...byKind.properNouns,
  ].filter((frag) => !factContainsFragment(factCorpus, rawFacts, frag));

  return { suspects: unique(suspects), byKind };
}

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (value == null) return acc;
  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, acc);
    return acc;
  }
  return acc;
}

function matchAll(strings: string[], re: RegExp): string[] {
  const out: string[] = [];
  for (const s of strings) {
    const matches = s.match(re);
    if (matches) out.push(...matches);
  }
  return out;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Normalise a string for comparison: NFKC (collapse fullwidth + homoglyphs),
 * replace NBSP/narrow NBSP with space, lowercase.
 */
function normaliseForCompare(s: string): string {
  return s.normalize('NFKC').replace(/[  ]/g, ' ').toLowerCase();
}

/**
 * True if the fragment appears in the facts. Tries: exact normalised substring,
 * comma-stripped-numeric substring, and (for proper nouns) a hyphen/whitespace-
 * collapsed substring so `Palo Alto` finds `palo-alto` in facts.
 */
function factContainsFragment(normFacts: string, rawFacts: string, fragment: string): boolean {
  const normFrag = normaliseForCompare(fragment);
  if (normFacts.includes(normFrag)) return true;
  const strippedFrag = normFrag.replace(/(\d),(\d)/g, '$1$2');
  const strippedFacts = normFacts.replace(/(\d),(\d)/g, '$1$2');
  if (strippedFacts.includes(strippedFrag)) return true;
  const collapsed = normFrag.replace(/\s+/g, '');
  if (rawFacts.replace(/[\s-]+/g, '').includes(collapsed)) return true;
  return false;
}
