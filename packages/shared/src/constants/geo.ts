// Geography primitives for the job-targeting feature (P1).
//
// Single source of truth for ISO-3166 alpha-2 countries, their coarse region
// and ISO-4217 currency, plus the closed vocabularies the targeting profile,
// `parseLocation`, relevance soft signals and `geoFit` all share. Pure data +
// pure helpers: no IO, no clock, safe to import from both api and web bundles.
//
// Ambiguity policy (mirrors job-targeting-design.md §5): a country is only
// returned when it can be established from an explicit token — never guessed
// from a city that exists in more than one country. Callers surface
// `unparsed: true` rather than inventing a value.

export const REGIONS = [
  'north_america',
  'south_america',
  'europe',
  'africa',
  'middle_east',
  'asia_pacific',
] as const;
export type Region = (typeof REGIONS)[number];

export const WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const REMOTE_SCOPES = ['remote_local', 'remote_regional', 'remote_global'] as const;
export type RemoteScope = (typeof REMOTE_SCOPES)[number];

export const SPONSORSHIP_SIGNALS = ['likely', 'unclear', 'none'] as const;
export type SponsorshipSignal = (typeof SPONSORSHIP_SIGNALS)[number];

export interface Country {
  /** ISO-3166 alpha-2, uppercase. */
  code: string;
  name: string;
  region: Region;
  /** ISO-4217 currency code. */
  currency: string;
}

/** Compact dataset: [alpha-2, English name, region, currency]. */
const COUNTRY_DATA: ReadonlyArray<readonly [string, string, Region, string]> = [
  // ── North America (incl. Central America + Caribbean) ────────────────────
  ['AG', 'Antigua and Barbuda', 'north_america', 'XCD'],
  ['BS', 'Bahamas', 'north_america', 'BSD'],
  ['BB', 'Barbados', 'north_america', 'BBD'],
  ['BZ', 'Belize', 'north_america', 'BZD'],
  ['CA', 'Canada', 'north_america', 'CAD'],
  ['CR', 'Costa Rica', 'north_america', 'CRC'],
  ['CU', 'Cuba', 'north_america', 'CUP'],
  ['DM', 'Dominica', 'north_america', 'XCD'],
  ['DO', 'Dominican Republic', 'north_america', 'DOP'],
  ['SV', 'El Salvador', 'north_america', 'USD'],
  ['GD', 'Grenada', 'north_america', 'XCD'],
  ['GT', 'Guatemala', 'north_america', 'GTQ'],
  ['HT', 'Haiti', 'north_america', 'HTG'],
  ['HN', 'Honduras', 'north_america', 'HNL'],
  ['JM', 'Jamaica', 'north_america', 'JMD'],
  ['MX', 'Mexico', 'north_america', 'MXN'],
  ['NI', 'Nicaragua', 'north_america', 'NIO'],
  ['PA', 'Panama', 'north_america', 'PAB'],
  ['KN', 'Saint Kitts and Nevis', 'north_america', 'XCD'],
  ['LC', 'Saint Lucia', 'north_america', 'XCD'],
  ['VC', 'Saint Vincent and the Grenadines', 'north_america', 'XCD'],
  ['TT', 'Trinidad and Tobago', 'north_america', 'TTD'],
  ['US', 'United States', 'north_america', 'USD'],
  // ── South America ────────────────────────────────────────────────────────
  ['AR', 'Argentina', 'south_america', 'ARS'],
  ['BO', 'Bolivia', 'south_america', 'BOB'],
  ['BR', 'Brazil', 'south_america', 'BRL'],
  ['CL', 'Chile', 'south_america', 'CLP'],
  ['CO', 'Colombia', 'south_america', 'COP'],
  ['EC', 'Ecuador', 'south_america', 'USD'],
  ['GY', 'Guyana', 'south_america', 'GYD'],
  ['PY', 'Paraguay', 'south_america', 'PYG'],
  ['PE', 'Peru', 'south_america', 'PEN'],
  ['SR', 'Suriname', 'south_america', 'SRD'],
  ['UY', 'Uruguay', 'south_america', 'UYU'],
  ['VE', 'Venezuela', 'south_america', 'VES'],
  // ── Europe ───────────────────────────────────────────────────────────────
  ['AL', 'Albania', 'europe', 'ALL'],
  ['AD', 'Andorra', 'europe', 'EUR'],
  ['AT', 'Austria', 'europe', 'EUR'],
  ['BY', 'Belarus', 'europe', 'BYN'],
  ['BE', 'Belgium', 'europe', 'EUR'],
  ['BA', 'Bosnia and Herzegovina', 'europe', 'BAM'],
  ['BG', 'Bulgaria', 'europe', 'BGN'],
  ['HR', 'Croatia', 'europe', 'EUR'],
  ['CY', 'Cyprus', 'europe', 'EUR'],
  ['CZ', 'Czechia', 'europe', 'CZK'],
  ['DK', 'Denmark', 'europe', 'DKK'],
  ['EE', 'Estonia', 'europe', 'EUR'],
  ['FI', 'Finland', 'europe', 'EUR'],
  ['FR', 'France', 'europe', 'EUR'],
  ['DE', 'Germany', 'europe', 'EUR'],
  ['GR', 'Greece', 'europe', 'EUR'],
  ['HU', 'Hungary', 'europe', 'HUF'],
  ['IS', 'Iceland', 'europe', 'ISK'],
  ['IE', 'Ireland', 'europe', 'EUR'],
  ['IT', 'Italy', 'europe', 'EUR'],
  ['XK', 'Kosovo', 'europe', 'EUR'],
  ['LV', 'Latvia', 'europe', 'EUR'],
  ['LI', 'Liechtenstein', 'europe', 'CHF'],
  ['LT', 'Lithuania', 'europe', 'EUR'],
  ['LU', 'Luxembourg', 'europe', 'EUR'],
  ['MT', 'Malta', 'europe', 'EUR'],
  ['MD', 'Moldova', 'europe', 'MDL'],
  ['MC', 'Monaco', 'europe', 'EUR'],
  ['ME', 'Montenegro', 'europe', 'EUR'],
  ['NL', 'Netherlands', 'europe', 'EUR'],
  ['MK', 'North Macedonia', 'europe', 'MKD'],
  ['NO', 'Norway', 'europe', 'NOK'],
  ['PL', 'Poland', 'europe', 'PLN'],
  ['PT', 'Portugal', 'europe', 'EUR'],
  ['RO', 'Romania', 'europe', 'RON'],
  ['RU', 'Russia', 'europe', 'RUB'],
  ['SM', 'San Marino', 'europe', 'EUR'],
  ['RS', 'Serbia', 'europe', 'RSD'],
  ['SK', 'Slovakia', 'europe', 'EUR'],
  ['SI', 'Slovenia', 'europe', 'EUR'],
  ['ES', 'Spain', 'europe', 'EUR'],
  ['SE', 'Sweden', 'europe', 'SEK'],
  ['CH', 'Switzerland', 'europe', 'CHF'],
  ['UA', 'Ukraine', 'europe', 'UAH'],
  ['GB', 'United Kingdom', 'europe', 'GBP'],
  ['VA', 'Vatican City', 'europe', 'EUR'],
  // ── Middle East ──────────────────────────────────────────────────────────
  ['BH', 'Bahrain', 'middle_east', 'BHD'],
  ['IR', 'Iran', 'middle_east', 'IRR'],
  ['IQ', 'Iraq', 'middle_east', 'IQD'],
  ['IL', 'Israel', 'middle_east', 'ILS'],
  ['JO', 'Jordan', 'middle_east', 'JOD'],
  ['KW', 'Kuwait', 'middle_east', 'KWD'],
  ['LB', 'Lebanon', 'middle_east', 'LBP'],
  ['OM', 'Oman', 'middle_east', 'OMR'],
  ['PS', 'Palestine', 'middle_east', 'ILS'],
  ['QA', 'Qatar', 'middle_east', 'QAR'],
  ['SA', 'Saudi Arabia', 'middle_east', 'SAR'],
  ['SY', 'Syria', 'middle_east', 'SYP'],
  ['TR', 'Turkey', 'middle_east', 'TRY'],
  ['AE', 'United Arab Emirates', 'middle_east', 'AED'],
  ['YE', 'Yemen', 'middle_east', 'YER'],
  // ── Africa ───────────────────────────────────────────────────────────────
  ['DZ', 'Algeria', 'africa', 'DZD'],
  ['AO', 'Angola', 'africa', 'AOA'],
  ['BJ', 'Benin', 'africa', 'XOF'],
  ['BW', 'Botswana', 'africa', 'BWP'],
  ['BF', 'Burkina Faso', 'africa', 'XOF'],
  ['BI', 'Burundi', 'africa', 'BIF'],
  ['CV', 'Cabo Verde', 'africa', 'CVE'],
  ['CM', 'Cameroon', 'africa', 'XAF'],
  ['CF', 'Central African Republic', 'africa', 'XAF'],
  ['TD', 'Chad', 'africa', 'XAF'],
  ['KM', 'Comoros', 'africa', 'KMF'],
  ['CG', 'Congo', 'africa', 'XAF'],
  ['CD', 'Democratic Republic of the Congo', 'africa', 'CDF'],
  ['CI', 'Côte d’Ivoire', 'africa', 'XOF'],
  ['DJ', 'Djibouti', 'africa', 'DJF'],
  ['EG', 'Egypt', 'africa', 'EGP'],
  ['GQ', 'Equatorial Guinea', 'africa', 'XAF'],
  ['ER', 'Eritrea', 'africa', 'ERN'],
  ['SZ', 'Eswatini', 'africa', 'SZL'],
  ['ET', 'Ethiopia', 'africa', 'ETB'],
  ['GA', 'Gabon', 'africa', 'XAF'],
  ['GM', 'Gambia', 'africa', 'GMD'],
  ['GH', 'Ghana', 'africa', 'GHS'],
  ['GN', 'Guinea', 'africa', 'GNF'],
  ['GW', 'Guinea-Bissau', 'africa', 'XOF'],
  ['KE', 'Kenya', 'africa', 'KES'],
  ['LS', 'Lesotho', 'africa', 'LSL'],
  ['LR', 'Liberia', 'africa', 'LRD'],
  ['LY', 'Libya', 'africa', 'LYD'],
  ['MG', 'Madagascar', 'africa', 'MGA'],
  ['MW', 'Malawi', 'africa', 'MWK'],
  ['ML', 'Mali', 'africa', 'XOF'],
  ['MR', 'Mauritania', 'africa', 'MRU'],
  ['MU', 'Mauritius', 'africa', 'MUR'],
  ['MA', 'Morocco', 'africa', 'MAD'],
  ['MZ', 'Mozambique', 'africa', 'MZN'],
  ['NA', 'Namibia', 'africa', 'NAD'],
  ['NE', 'Niger', 'africa', 'XOF'],
  ['NG', 'Nigeria', 'africa', 'NGN'],
  ['RW', 'Rwanda', 'africa', 'RWF'],
  ['ST', 'Sao Tome and Principe', 'africa', 'STN'],
  ['SN', 'Senegal', 'africa', 'XOF'],
  ['SC', 'Seychelles', 'africa', 'SCR'],
  ['SL', 'Sierra Leone', 'africa', 'SLE'],
  ['SO', 'Somalia', 'africa', 'SOS'],
  ['ZA', 'South Africa', 'africa', 'ZAR'],
  ['SS', 'South Sudan', 'africa', 'SSP'],
  ['SD', 'Sudan', 'africa', 'SDG'],
  ['TZ', 'Tanzania', 'africa', 'TZS'],
  ['TG', 'Togo', 'africa', 'XOF'],
  ['TN', 'Tunisia', 'africa', 'TND'],
  ['UG', 'Uganda', 'africa', 'UGX'],
  ['ZM', 'Zambia', 'africa', 'ZMW'],
  ['ZW', 'Zimbabwe', 'africa', 'ZWL'],
  // ── Asia-Pacific ─────────────────────────────────────────────────────────
  ['AF', 'Afghanistan', 'asia_pacific', 'AFN'],
  ['AM', 'Armenia', 'asia_pacific', 'AMD'],
  ['AZ', 'Azerbaijan', 'asia_pacific', 'AZN'],
  ['BD', 'Bangladesh', 'asia_pacific', 'BDT'],
  ['BT', 'Bhutan', 'asia_pacific', 'BTN'],
  ['BN', 'Brunei', 'asia_pacific', 'BND'],
  ['KH', 'Cambodia', 'asia_pacific', 'KHR'],
  ['CN', 'China', 'asia_pacific', 'CNY'],
  ['GE', 'Georgia', 'asia_pacific', 'GEL'],
  ['HK', 'Hong Kong', 'asia_pacific', 'HKD'],
  ['IN', 'India', 'asia_pacific', 'INR'],
  ['ID', 'Indonesia', 'asia_pacific', 'IDR'],
  ['JP', 'Japan', 'asia_pacific', 'JPY'],
  ['KZ', 'Kazakhstan', 'asia_pacific', 'KZT'],
  ['KG', 'Kyrgyzstan', 'asia_pacific', 'KGS'],
  ['LA', 'Laos', 'asia_pacific', 'LAK'],
  ['MO', 'Macao', 'asia_pacific', 'MOP'],
  ['MY', 'Malaysia', 'asia_pacific', 'MYR'],
  ['MV', 'Maldives', 'asia_pacific', 'MVR'],
  ['MN', 'Mongolia', 'asia_pacific', 'MNT'],
  ['MM', 'Myanmar', 'asia_pacific', 'MMK'],
  ['NP', 'Nepal', 'asia_pacific', 'NPR'],
  ['NZ', 'New Zealand', 'asia_pacific', 'NZD'],
  ['KP', 'North Korea', 'asia_pacific', 'KPW'],
  ['PK', 'Pakistan', 'asia_pacific', 'PKR'],
  ['PH', 'Philippines', 'asia_pacific', 'PHP'],
  ['SG', 'Singapore', 'asia_pacific', 'SGD'],
  ['KR', 'South Korea', 'asia_pacific', 'KRW'],
  ['LK', 'Sri Lanka', 'asia_pacific', 'LKR'],
  ['TW', 'Taiwan', 'asia_pacific', 'TWD'],
  ['TJ', 'Tajikistan', 'asia_pacific', 'TJS'],
  ['TH', 'Thailand', 'asia_pacific', 'THB'],
  ['TL', 'Timor-Leste', 'asia_pacific', 'USD'],
  ['TM', 'Turkmenistan', 'asia_pacific', 'TMT'],
  ['UZ', 'Uzbekistan', 'asia_pacific', 'UZS'],
  ['VN', 'Vietnam', 'asia_pacific', 'VND'],
  // ── Oceania (mapped to asia_pacific for a single APAC bucket) ────────────
  ['AU', 'Australia', 'asia_pacific', 'AUD'],
  ['FJ', 'Fiji', 'asia_pacific', 'FJD'],
  ['PG', 'Papua New Guinea', 'asia_pacific', 'PGK'],
  ['WS', 'Samoa', 'asia_pacific', 'WST'],
  ['SB', 'Solomon Islands', 'asia_pacific', 'SBD'],
  ['TO', 'Tonga', 'asia_pacific', 'TOP'],
  ['VU', 'Vanuatu', 'asia_pacific', 'VUV'],
];

export const COUNTRIES: readonly Country[] = COUNTRY_DATA.map(([code, name, region, currency]) => ({
  code,
  name,
  region,
  currency,
}));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Explicit aliases beyond the official name. Kept small + unambiguous. */
const COUNTRY_ALIASES: Record<string, readonly string[]> = {
  US: ['united states of america', 'usa', 'u.s.', 'u.s.a.', 'america'],
  GB: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  AE: ['uae', 'u.a.e.', 'dubai'],
  KR: ['republic of korea', 'korea'],
  CZ: ['czech republic'],
  NL: ['holland', 'the netherlands'],
  RU: ['russian federation'],
  VN: ['viet nam'],
  BO: ['bolivia (plurinational state of)'],
  VE: ['venezuela (bolivarian republic of)'],
  IR: ['iran (islamic republic of)'],
  SY: ['syrian arab republic'],
  MD: ['republic of moldova'],
  TZ: ['united republic of tanzania'],
};

/** Normalize a name/alias for lookup: lowercase, strip periods, collapse spaces. */
function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

/** Country name + alias (normalized) → Country, for free-text matching. */
const BY_NAME = new Map<string, Country>();
for (const c of COUNTRIES) {
  BY_NAME.set(nameKey(c.name), c);
  for (const alias of COUNTRY_ALIASES[c.code] ?? []) BY_NAME.set(nameKey(alias), c);
}

/** ISO-3166 alpha-2 check. Uppercase input only (codes are stored uppercase). */
export function isCountry(code: string): boolean {
  return BY_CODE.has(code);
}

/** All countries whose `region` matches. Returns `[]` for an unknown region. */
export function countriesOfRegion(region: Region | string): Country[] {
  return COUNTRIES.filter((c) => c.region === region);
}

export function countryByCode(code: string): Country | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

export function isWorkplaceType(value: string): value is WorkplaceType {
  return (WORKPLACE_TYPES as readonly string[]).includes(value);
}

export function isRemoteScope(value: string): value is RemoteScope {
  return (REMOTE_SCOPES as readonly string[]).includes(value);
}

/** Resolve a country from an English name or common alias. Case-insensitive. */
export function countryByName(name: string): Country | undefined {
  const key = nameKey(name);
  if (!key) return undefined;
  return BY_NAME.get(key);
}
