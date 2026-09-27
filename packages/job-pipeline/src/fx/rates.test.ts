import { describe, expect, it } from 'vitest';
import { convertToUsd, convertToUsdBand, rates } from './rates';

describe('fx/rates (C-P3.3)', () => {
  it('snapshot metadata is intact (base=USD, fetchedAt set, source is exchangerate-api)', () => {
    expect(rates.base).toBe('USD');
    expect(rates.fetchedAt).toBe('2026-09-27');
    expect(rates.source).toBe('https://open.er-api.com/v6/latest/USD');
    expect(rates.rates.USD).toBe(1);
  });

  it('USD → USD is identity', () => {
    expect(convertToUsd({ amount: 1000, currency: 'USD' })).toBe(1000);
  });

  it('EUR → USD divides by the EUR rate (EUR/USD ≈ 1.14)', () => {
    const eurRate = rates.rates.EUR!;
    expect(convertToUsd({ amount: 1000, currency: 'EUR' })).toBeCloseTo(1000 / eurRate, 6);
    // Sanity: 100 EUR should be a bit more than 100 USD given fetch-date rates.
    expect(convertToUsd({ amount: 100, currency: 'EUR' })!).toBeGreaterThan(100);
  });

  it('INR → USD (large-denominator currency)', () => {
    const usd = convertToUsd({ amount: 100_000, currency: 'INR' });
    // ~1042 USD at fetch-date rates; must be positive and much smaller than input.
    expect(usd).not.toBeNull();
    expect(usd!).toBeGreaterThan(500);
    expect(usd!).toBeLessThan(2000);
  });

  it('case-insensitive on currency code', () => {
    const a = convertToUsd({ amount: 1000, currency: 'eur' });
    const b = convertToUsd({ amount: 1000, currency: 'EUR' });
    expect(a).toBe(b);
  });

  it('unknown currency returns null (never fabricates a rate)', () => {
    expect(convertToUsd({ amount: 100, currency: 'XYZ' })).toBeNull();
    expect(convertToUsd({ amount: 100, currency: 'BTC' })).toBeNull();
  });

  it('non-finite amount returns null', () => {
    expect(convertToUsd({ amount: NaN, currency: 'USD' })).toBeNull();
    expect(convertToUsd({ amount: Infinity, currency: 'USD' })).toBeNull();
  });

  it('convertToUsdBand: yearly USD passthrough', () => {
    const out = convertToUsdBand({ min: 150_000, max: 200_000, currency: 'USD', period: 'year' });
    expect(out).toEqual({ min: 150_000, max: 200_000, currency: 'USD', period: 'year' });
  });

  it('convertToUsdBand: monthly EUR annualised (×12) and FX-converted', () => {
    const out = convertToUsdBand({ min: 5_000, max: 7_000, currency: 'EUR', period: 'month' });
    expect(out).not.toBeNull();
    // 5000 EUR * 12 = 60000 EUR/yr → some USD amount. Must round-trip within FX precision.
    const eurRate = rates.rates.EUR!;
    expect(out!.min).toBe(Math.round((5_000 / eurRate) * 12));
    expect(out!.max).toBe(Math.round((7_000 / eurRate) * 12));
    expect(out!.currency).toBe('USD');
    expect(out!.period).toBe('year');
  });

  it('convertToUsdBand: hourly USD annualised at 2080 h/yr', () => {
    const out = convertToUsdBand({ min: 80, max: 100, currency: 'USD', period: 'hour' });
    expect(out).toEqual({ min: 80 * 2080, max: 100 * 2080, currency: 'USD', period: 'year' });
  });

  it('convertToUsdBand: unknown currency → null (does not silently drop to 0)', () => {
    expect(convertToUsdBand({ min: 100, max: 200, currency: 'XYZ', period: 'year' })).toBeNull();
  });

  it('round-trip: convert USD → EUR-rate * amount → back within rounding error', () => {
    // Sanity: converting X USD → X USD via a currency and back is identity to <1 unit.
    const original = 123_456;
    // Fake a EUR band that would produce `original` USD/yr.
    const eurRate = rates.rates.EUR!;
    const eurAmount = original * eurRate;
    const back = convertToUsd({ amount: eurAmount, currency: 'EUR' });
    expect(back).toBeCloseTo(original, 4);
  });
});
