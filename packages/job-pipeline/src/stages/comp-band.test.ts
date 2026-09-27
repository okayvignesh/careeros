import { describe, expect, it } from 'vitest';
import { parseCompBand } from './comp-band';

describe('parseCompBand (C-P3.3)', () => {
  // --- USD ---
  it('$150k - $200k → USD/year 150k-200k', () => {
    expect(parseCompBand('$150k - $200k')).toEqual({
      min: 150_000, max: 200_000, currency: 'USD', period: 'year',
    });
  });

  it('$150,000-$200,000/yr', () => {
    expect(parseCompBand('$150,000-$200,000/yr')).toEqual({
      min: 150_000, max: 200_000, currency: 'USD', period: 'year',
    });
  });

  it('USD 150000 per year → single value', () => {
    expect(parseCompBand('USD 150000 per year')).toEqual({
      min: 150_000, max: 150_000, currency: 'USD', period: 'year',
    });
  });

  it('USD 150000/yr to USD 200000/yr', () => {
    expect(parseCompBand('USD 150000/yr to USD 200000/yr')).toEqual({
      min: 150_000, max: 200_000, currency: 'USD', period: 'year',
    });
  });

  // --- CAD / AUD / other codes ---
  it('120K CAD → CAD/year 120k-120k', () => {
    expect(parseCompBand('120K CAD')).toEqual({
      min: 120_000, max: 120_000, currency: 'CAD', period: 'year',
    });
  });

  it('AUD 90k - 130k', () => {
    expect(parseCompBand('AUD 90k - 130k')).toEqual({
      min: 90_000, max: 130_000, currency: 'AUD', period: 'year',
    });
  });

  // --- EUR ---
  it('€90k-120k', () => {
    expect(parseCompBand('€90k-120k')).toEqual({
      min: 90_000, max: 120_000, currency: 'EUR', period: 'year',
    });
  });

  it('EUR 80000 to 100000 per year', () => {
    expect(parseCompBand('EUR 80000 to 100000 per year')).toEqual({
      min: 80_000, max: 100_000, currency: 'EUR', period: 'year',
    });
  });

  // --- GBP ---
  it('£45,000 to £60,000', () => {
    expect(parseCompBand('£45,000 to £60,000')).toEqual({
      min: 45_000, max: 60_000, currency: 'GBP', period: 'year',
    });
  });

  // --- INR: lakh + crore ---
  it('₹40L - ₹60L → INR lakh expansion', () => {
    expect(parseCompBand('₹40L - ₹60L')).toEqual({
      min: 4_000_000, max: 6_000_000, currency: 'INR', period: 'year',
    });
  });

  it('₹1.2Cr → INR crore', () => {
    expect(parseCompBand('₹1.2Cr')).toEqual({
      min: 12_000_000, max: 12_000_000, currency: 'INR', period: 'year',
    });
  });

  it('INR 25L to 40L per annum', () => {
    expect(parseCompBand('INR 25L to 40L per annum')).toEqual({
      min: 2_500_000, max: 4_000_000, currency: 'INR', period: 'year',
    });
  });

  // --- JPY / CNY / KRW ---
  it('¥10,000,000 → JPY/year', () => {
    expect(parseCompBand('¥10,000,000')).toEqual({
      min: 10_000_000, max: 10_000_000, currency: 'JPY', period: 'year',
    });
  });

  it('KRW 60,000,000 - 90,000,000', () => {
    expect(parseCompBand('KRW 60,000,000 - 90,000,000')).toEqual({
      min: 60_000_000, max: 90_000_000, currency: 'KRW', period: 'year',
    });
  });

  // --- hourly ---
  it('$80/hr → USD/hour', () => {
    expect(parseCompBand('$80/hr')).toEqual({
      min: 80, max: 80, currency: 'USD', period: 'hour',
    });
  });

  it('€35 per hour → EUR/hour', () => {
    expect(parseCompBand('€35 per hour')).toEqual({
      min: 35, max: 35, currency: 'EUR', period: 'hour',
    });
  });

  it('$60 - $90 hourly', () => {
    expect(parseCompBand('$60 - $90 hourly')).toEqual({
      min: 60, max: 90, currency: 'USD', period: 'hour',
    });
  });

  // --- monthly ---
  it('$8000/month → USD/month', () => {
    expect(parseCompBand('$8000/month')).toEqual({
      min: 8_000, max: 8_000, currency: 'USD', period: 'month',
    });
  });

  it('EUR 5000 - 7000 per month', () => {
    expect(parseCompBand('EUR 5000 - 7000 per month')).toEqual({
      min: 5_000, max: 7_000, currency: 'EUR', period: 'month',
    });
  });

  // --- $1.2M ---
  it('$1.2M compensation → single-value USD', () => {
    expect(parseCompBand('$1.2M compensation')).toEqual({
      min: 1_200_000, max: 1_200_000, currency: 'USD', period: 'year',
    });
  });

  // --- refusals ---
  it('bare number "80000" → null (no currency signal)', () => {
    expect(parseCompBand('80000')).toBeNull();
  });

  it('empty / null / undefined → null', () => {
    expect(parseCompBand('')).toBeNull();
    expect(parseCompBand(null)).toBeNull();
    expect(parseCompBand(undefined)).toBeNull();
  });

  it('"competitive salary" → null', () => {
    expect(parseCompBand('competitive salary + equity')).toBeNull();
  });

  it('"DOE" (depends on experience) → null', () => {
    expect(parseCompBand('DOE')).toBeNull();
  });

  // MUTATION SMOKE: if lakh multiplier flipped to 10k (a naive misread of "L"),
  // this test would break; explicit expansion catches it.
  it('₹1L expands to 100000 exactly', () => {
    expect(parseCompBand('₹1L')).toEqual({
      min: 100_000, max: 100_000, currency: 'INR', period: 'year',
    });
  });

  // MUTATION SMOKE: swapping min/max direction (`Math.max` for min) fails here.
  it('handles reversed order "$200k to $150k" by sorting min/max', () => {
    const b = parseCompBand('$200k to $150k');
    expect(b?.min).toBe(150_000);
    expect(b?.max).toBe(200_000);
  });
});
