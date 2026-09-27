import ratesFile from './rates.json';

/**
 * FX conversion against USD, using a bundled snapshot in `rates.json`.
 *
 * ponytail: hardcoded rates snapshot; refresh quarterly via a scheduled
 * workflow OR wire a runtime fetch through safeFetch when needed. Salary bands
 * shift by tens of percent between roles; a few percent FX drift is noise.
 *
 * Snapshot source: https://open.er-api.com/v6/latest/USD  fetched 2026-09-27.
 */

export interface RatesSnapshot {
  base: 'USD';
  fetchedAt: string;
  source: string;
  rates: Record<string, number>;
}

export const rates = ratesFile as RatesSnapshot;

export interface Money {
  amount: number;
  currency: string;
}

export interface CompBand {
  min: number;
  max: number;
  currency: string;
  period: 'hour' | 'month' | 'year';
}

export interface CompBandUsd {
  min: number;
  max: number;
  currency: 'USD';
  period: 'year';
}

/**
 * Convert an amount in `currency` to USD using the bundled snapshot. Unknown
 * currency (not in rates.json) returns `null` — callers decide whether to log,
 * drop, or fall back. Case-insensitive on the currency code.
 */
export function convertToUsd(m: Money): number | null {
  const code = m.currency.toUpperCase();
  const rate = rates.rates[code];
  if (rate === undefined || rate <= 0) return null;
  if (!Number.isFinite(m.amount)) return null;
  return m.amount / rate;
}

/**
 * Convert a `CompBand` to USD/year. Handles the period-normalization ladder:
 * hourly * 2080, monthly * 12, yearly unchanged. Returns `null` if the
 * currency is unknown so the caller stores the original band unmodified.
 *
 * Hours-per-year uses 2080 (40 h/wk * 52 wk) — the US BLS convention and a
 * defensible default for a "typical" salaried role. Adapters emitting hourly
 * ranges for freelance/gig work will overstate annualized comp; that's a known
 * ceiling.
 */
export function convertToUsdBand(band: CompBand): CompBandUsd | null {
  const minUsd = convertToUsd({ amount: band.min, currency: band.currency });
  const maxUsd = convertToUsd({ amount: band.max, currency: band.currency });
  if (minUsd === null || maxUsd === null) return null;
  const mult = band.period === 'hour' ? 2080 : band.period === 'month' ? 12 : 1;
  return {
    min: Math.round(minUsd * mult),
    max: Math.round(maxUsd * mult),
    currency: 'USD',
    period: 'year',
  };
}
