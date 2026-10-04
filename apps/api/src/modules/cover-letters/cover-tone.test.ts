import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { COVER_TONES, isCoverTone, selectCoverTone } from './cover-tone';

describe('cover tone selection (code-only enum)', () => {
  it('exposes a closed enum', () => {
    expect([...COVER_TONES]).toEqual(['professional', 'concise', 'enthusiastic', 'warm']);
    expect(isCoverTone('professional')).toBe(true);
    expect(isCoverTone('sassy')).toBe(false);
  });

  it('staff/principal → concise', () => {
    expect(selectCoverTone({ seniority: ['staff'], relocationWilling: false })).toBe('concise');
    expect(selectCoverTone({ seniority: ['principal'], relocationWilling: true })).toBe('concise');
  });

  it('senior/manager → professional', () => {
    expect(selectCoverTone({ seniority: ['senior'], relocationWilling: false })).toBe('professional');
    expect(selectCoverTone({ seniority: ['manager'], relocationWilling: true })).toBe('professional');
  });

  it('relocation (junior/mid) → warm; otherwise enthusiastic', () => {
    expect(selectCoverTone({ seniority: ['mid'], relocationWilling: true })).toBe('warm');
    expect(selectCoverTone({ seniority: ['junior'], relocationWilling: false })).toBe('enthusiastic');
  });

  it('explicit valid override wins', () => {
    expect(
      selectCoverTone({ seniority: ['staff'], relocationWilling: false, explicit: 'warm' }),
    ).toBe('warm');
  });

  it('rejects an unknown explicit tone with 400', () => {
    expect(() =>
      selectCoverTone({ seniority: ['mid'], relocationWilling: false, explicit: 'angry' }),
    ).toThrow(BadRequestException);
  });
});
