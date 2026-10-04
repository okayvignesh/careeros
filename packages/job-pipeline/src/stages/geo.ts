// Geo normalization — pure, deterministic, never throws (job-targeting §5).
//
// Two independent primitives:
//   - `parseLocation(raw)` maps a free-text location to structured geography.
//     Ambiguous cities without country context resolve to `country: undefined`
//     + `unparsed: true` — we never guess a country. Workplace/remote tokens
//     parse independently of the geographic tokens.
//   - `sponsorshipSignal(description)` reads visa-sponsorship language. It never
//     defaults to `likely`: a `likely` verdict requires at least one positive
//     match, any negation forces `none`, and silence is honestly `unclear`.
//
// Nothing here owns persistence: callers keep `jobs_raw` append-only and store
// evidence only when the verdict is not `unclear`.
import {
  countryByCode,
  countryByName,
  isCountry,
  type Region,
  type RemoteScope,
  type SponsorshipSignal,
  type WorkplaceType,
} from '@careeros/shared';

export interface ParsedLocation {
  /** ISO-3166 alpha-2, only when established by an explicit token. */
  country?: string;
  region?: Region;
  city?: string;
  workplaceType?: WorkplaceType;
  remoteScope?: RemoteScope;
  /** True when the raw string could not be fully interpreted (nothing guessed). */
  unparsed?: boolean;
}

/**
 * City → the countries it can denote. A single entry means the city is
 * unambiguous (still derived from data, not guessed); two entries force the
 * caller to supply a country token or get `unparsed`.
 */
const CITY_GAZETTEER: Record<string, readonly string[]> = {
  london: ['GB', 'CA'],
  paris: ['FR', 'US'],
  berlin: ['DE'],
  munich: ['DE'],
  'münchen': ['DE'],
  frankfurt: ['DE'],
  hamburg: ['DE'],
  bengaluru: ['IN'],
  bangalore: ['IN'],
  mumbai: ['IN'],
  bombay: ['IN'],
  pune: ['IN'],
  hyderabad: ['IN'],
  chennai: ['IN'],
  delhi: ['IN'],
  'new delhi': ['IN'],
  noida: ['IN'],
  gurgaon: ['IN'],
  gurugram: ['IN'],
  tokyo: ['JP'],
  singapore: ['SG'],
  sydney: ['AU'],
  melbourne: ['AU'],
  brisbane: ['AU'],
  perth: ['AU'],
  toronto: ['CA'],
  vancouver: ['CA'],
  montreal: ['CA'],
  'new york': ['US'],
  nyc: ['US'],
  'san francisco': ['US'],
  seattle: ['US'],
  austin: ['US'],
  boston: ['US'],
  chicago: ['US'],
  'los angeles': ['US'],
  denver: ['US'],
  atlanta: ['US'],
  dallas: ['US'],
  amsterdam: ['NL'],
  rotterdam: ['NL'],
  dublin: ['IE'],
  madrid: ['ES'],
  barcelona: ['ES'],
  lisbon: ['PT'],
  porto: ['PT'],
  rome: ['IT'],
  milan: ['IT'],
  stockholm: ['SE'],
  oslo: ['NO'],
  copenhagen: ['DK'],
  helsinki: ['FI'],
  warsaw: ['PL'],
  prague: ['CZ'],
  vienna: ['AT'],
  zurich: ['CH'],
  'zürich': ['CH'],
  geneva: ['CH'],
  brussels: ['BE'],
  'tel aviv': ['IL'],
  dubai: ['AE'],
  'abu dhabi': ['AE'],
  riyadh: ['SA'],
  doha: ['QA'],
  istanbul: ['TR'],
  cairo: ['EG'],
  lagos: ['NG'],
  nairobi: ['KE'],
  'cape town': ['ZA'],
  johannesburg: ['ZA'],
  'sao paulo': ['BR'],
  'são paulo': ['BR'],
  'rio de janeiro': ['BR'],
  'buenos aires': ['AR'],
  'mexico city': ['MX'],
  bogota: ['CO'],
  'bogotá': ['CO'],
  santiago: ['CL'],
  lima: ['PE'],
  bangkok: ['TH'],
  'kuala lumpur': ['MY'],
  jakarta: ['ID'],
  manila: ['PH'],
  'hong kong': ['HK'],
  taipei: ['TW'],
  seoul: ['KR'],
  shanghai: ['CN'],
  beijing: ['CN'],
  shenzhen: ['CN'],
  auckland: ['NZ'],
  wellington: ['NZ'],
  hanoi: ['VN'],
  'ho chi minh city': ['VN'],
  saigon: ['VN'],
};

/** Region tokens → our macro regions. EMEA is intentionally omitted (it spans
 *  three of our regions, so claiming one would be a guess). */
const REGION_TOKENS: ReadonlyArray<readonly [RegExp, Region]> = [
  [/\bnorth\s+america\b/, 'north_america'],
  [/\b(?:south|latin)\s+america\b|\blatam\b/, 'south_america'],
  [/\beurope\b|\beuropean\s+union\b|\beu\b/, 'europe'],
  [/\bafrica\b/, 'africa'],
  [/\bmiddle\s+east\b|\bmena\b/, 'middle_east'],
  [/\basia[-\s]?pacific\b|\bapac\b|\basia\b/, 'asia_pacific'],
];

const WORKPLACE_PATTERNS: ReadonlyArray<readonly [RegExp, WorkplaceType]> = [
  [/\bremote\b|work\s+from\s+home|\bwfh\b|telecommut|work\s+from\s+anywhere|anywhere/, 'remote'],
  [/\bhybrid\b|partially\s+remote|flexible\s+work|part\s+remote/, 'hybrid'],
  [/\bonsite\b|on-site|in[-\s]?office|in[-\s]?person|\boffice\s+based\b/, 'onsite'],
];

const GLOBAL_REMOTE = /worldwide|anywhere|global|work\s+from\s+anywhere/;

/** Parse a free-text location. Never throws; empty input → `{}`. */
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  const text = (raw ?? '').trim();
  if (!text) return {};
  const lower = text.toLowerCase();
  const out: ParsedLocation = {};

  // Workplaces parse independently of the geographic tokens.
  for (const [re, value] of WORKPLACE_PATTERNS) {
    if (re.test(lower)) {
      out.workplaceType = value;
      break;
    }
  }

  // Explicit country: aliased names in comma/slash segments win over bare codes
  // (which can collide with US state abbreviations), and the last code wins in
  // the common "City, State, Country" convention.
  const nameMatches: string[] = [];
  for (const segment of lower.split(/[,;/|]/)) {
    const c = countryByName(segment);
    if (c) nameMatches.push(c.code);
  }
  const codeMatches = Array.from(text.matchAll(/\b([A-Z]{2})\b/g))
    .map((m) => m[1]!)
    .filter((code) => isCountry(code));
  // A bare lowercase code ("de") never matches the uppercase regex above, but
  // market-scoped sources hand us one (Adzuna path / Firecrawl market country).
  // Treat a segment that is exactly two letters as a code — whole-word matching
  // stays case-sensitive, so "Hybrid in Berlin" is not misread as India.
  const segmentCodes = lower
    .split(/[,;/|]/)
    .map((s) => s.trim())
    .filter((s) => /^[a-z]{2}$/.test(s))
    .map((s) => s.toUpperCase())
    .filter((code) => isCountry(code));
  const codes = Array.from(new Set([...codeMatches, ...segmentCodes]));
  const explicit = nameMatches.length > 0 ? nameMatches : codes;
  const explicitCountry = explicit.length > 0 ? explicit[explicit.length - 1]! : undefined;

  // City: exact segment match first, then whole-word match inside a segment.
  const cities: string[] = [];
  const segments = lower.split(/[,;/|]/).map((s) => s.trim());
  for (const key of Object.keys(CITY_GAZETTEER)) {
    if (segments.includes(key)) cities.push(key);
    else if (new RegExp(`\\b${escapeRegExp(key)}\\b`).test(lower)) cities.push(key);
  }
  const city = cities[0];

  let country = explicitCountry;
  if (!country && city) {
    const candidates = CITY_GAZETTEER[city] ?? [];
    if (candidates.length === 1) country = candidates[0];
  }

  let region: Region | undefined;
  if (country) region = countryByCode(country)?.region;
  let regionFromToken: Region | undefined;
  for (const [re, value] of REGION_TOKENS) {
    if (re.test(lower)) {
      regionFromToken = value;
      break;
    }
  }
  if (!region) region = regionFromToken;

  // Remote scope: only meaningful when the string signals remote work. A
  // country/city target is local; an explicit region token is regional;
  // worldwide/anywhere is global.
  if (out.workplaceType === 'remote' || /\bremote\b/.test(lower)) {
    if (GLOBAL_REMOTE.test(lower)) out.remoteScope = 'remote_global';
    else if (regionFromToken) out.remoteScope = 'remote_regional';
    else if (country || city) out.remoteScope = 'remote_local';
  }

  if (country) out.country = country;
  if (region) out.region = region;
  if (city) out.city = city;

  // An ambiguous city with no country context is explicitly unparsed rather
  // than fabricating a country. A non-empty location with no recognised
  // geography (e.g. a made-up city) is also unparsed, while a pure
  // workplace/remote token ("Remote") parses cleanly.
  const ambiguousCity = Boolean(city) && !country && (CITY_GAZETTEER[city!]?.length ?? 0) > 1;
  const leftoverWord = /[a-z]{3,}/.test(stripWorkplaceTokens(lower));
  if (ambiguousCity || (!country && !region && !city && leftoverWord)) out.unparsed = true;
  return out;
}

/** Remove workplace/remote vocabulary so "leftover" text can be detected. */
function stripWorkplaceTokens(text: string): string {
  return text.replace(
    /remote|worldwide|anywhere|global|work\s+from\s+home|work\s+from\s+anywhere|\bwfh\b|hybrid|partially|on-?site|\bonsite\b|in[-\s]?office|in[-\s]?person|flexible\s+work|part\s+remote/g,
    ' ',
  );
}

export interface SponsorshipResult {
  value: SponsorshipSignal;
  /** Substrings that drove the verdict. Non-empty whenever `confidence > 0`. */
  matched: string[];
  /** 0 when there is no textual signal (`unclear`); > 0 otherwise. */
  confidence: number;
}

const NEGATION_PATTERNS: readonly RegExp[] = [
  /\bno\s+(?:visa\s+|immigration\s+)?sponsorship\b/,
  /\bno\s+(?:visa|immigration)\s+support\b/,
  /\bnot\s+(?:be\s+)?(?:able\s+to\s+)?sponsor\b/,
  /\b(?:we|company|employer|organization|organisation)\s+(?:do(?:es)?\s+not|don'?t|will\s+not|won'?t)\s+sponsor\b/,
  /\b(?:do(?:es)?\s+not|don'?t|cannot|can'?t|will\s+not|won'?t)\s+(?:offer|provide|support)\s+(?:visa\s+|immigration\s+)?sponsorship\b/,
  /\bunable\s+to\s+sponsor\b/,
  /\bcannot\s+sponsor\b|\bcan'?t\s+sponsor\b/,
  /\bmust\s+(?:be\s+)?(?:legally\s+)?authori[sz]ed\s+to\s+work\b/,
  /\bmust\s+(?:already\s+)?have\s+(?:the\s+)?(?:legal\s+)?(?:right|authori[sz]ation)\s+to\s+work\b/,
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/,
  /\bwithout\s+(?:visa\s+)?sponsorship\b/,
];

const POSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered|possible|supported)\b/,
  /\b(?:we|company|employer|organization|organisation)\s+(?:can|will|could|are\s+able\s+to)\s+sponsor\b/,
  /\b(?:we|company|employer|organization|organisation)\s+(?:offer|provide|support)s?\s+(?:visa\s+)?sponsorship\b/,
  /\bopen\s+to\s+sponsor(?:ing|ship)?\b/,
  /\bwilling\s+to\s+sponsor\b/,
  /\bsponsor(?:s|ing|ed)?\s+(?:work\s+)?visas?\b/,
  /\b(?:visa|immigration|work[-\s]?permit)\s+support\b/,
  /\brelocation\s+(?:and|&|\+)\s+(?:visa\s+)?sponsorship\b/,
  /\b(?:provide|offer|arrange)s?\s+(?:visa\s+)?sponsorship\b/,
];

/**
 * Read visa-sponsorship language from a job description. Negations dominate;
 * `likely` requires a positive match; no signal is `unclear` (never `likely`).
 */
export function sponsorshipSignal(description: string | null | undefined): SponsorshipResult {
  const text = (description ?? '').toLowerCase();
  if (!text.trim()) return { value: 'unclear', matched: [], confidence: 0 };

  const negations = collectMatches(text, NEGATION_PATTERNS);
  if (negations.length > 0) {
    return {
      value: 'none',
      matched: dedupe(negations),
      confidence: Math.min(1, 0.6 + 0.1 * negations.length),
    };
  }

  const positives = collectMatches(text, POSITIVE_PATTERNS);
  if (positives.length > 0) {
    return {
      value: 'likely',
      matched: dedupe(positives),
      confidence: Math.min(1, 0.5 + 0.15 * positives.length),
    };
  }

  return { value: 'unclear', matched: [], confidence: 0 };
}

function collectMatches(text: string, patterns: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const re of patterns) {
    // Fresh global-less regex each call; `match` returns the first hit only,
    // which is all the evidence needs.
    const m = re.exec(text);
    if (m?.[0]) hits.push(m[0].trim());
  }
  return hits;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
