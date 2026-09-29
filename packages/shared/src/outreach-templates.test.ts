import { describe, expect, it } from 'vitest';
import {
  INDUSTRY_VARIANTS,
  OUTREACH_TEMPLATES,
  OUTREACH_TEMPLATE_IDS,
  getOutreachTemplate,
  nextBusinessHourSlot,
} from './outreach-templates';

describe('OUTREACH_TEMPLATES', () => {
  it('has an entry for every declared id + a variantHint for every industry', () => {
    for (const id of OUTREACH_TEMPLATE_IDS) {
      const tpl = OUTREACH_TEMPLATES[id];
      expect(tpl.id).toBe(id);
      expect(tpl.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tpl.personaLine.length).toBeGreaterThan(10);
      expect(tpl.skeleton.length).toBeGreaterThanOrEqual(2);
      for (const variant of INDUSTRY_VARIANTS) {
        expect(typeof tpl.variantHints[variant]).toBe('string');
        expect(tpl.variantHints[variant].length).toBeGreaterThan(0);
      }
    }
    // MUTATION-SMOKE: add a variant to INDUSTRY_VARIANTS without adding
    // a hint entry and this fails per template.
  });

  it('getOutreachTemplate throws on unknown id', () => {
    expect(() => getOutreachTemplate('bogus')).toThrow(/Unknown outreach template/);
  });
});

describe('nextBusinessHourSlot', () => {
  it('returns nowUtc unchanged when inside business hours in tz', () => {
    // Wednesday 2026-06-17T14:00Z. In America/New_York that is 10:00 EDT (weekday, 09-17).
    const now = new Date('2026-06-17T14:00:00Z');
    expect(nextBusinessHourSlot('America/New_York', now).toISOString()).toBe(now.toISOString());
  });

  it('rolls to next weekday 09:00 local when after business hours', () => {
    // Wednesday 2026-06-17T22:00Z = 18:00 EDT (after hours).
    // Next slot: Thursday 09:00 EDT = 13:00Z. Wall-clock advance is
    // (24 - 18) + 9 = 15h so nowUtc + 15h = 2026-06-18T13:00Z.
    const now = new Date('2026-06-17T22:00:00Z');
    expect(nextBusinessHourSlot('America/New_York', now).toISOString()).toBe(
      '2026-06-18T13:00:00.000Z',
    );
  });

  it('skips Saturday and Sunday to Monday 09:00 local', () => {
    // Saturday 2026-06-20T14:00Z = 10:00 EDT (weekend).
    // Advance +2 days to Monday 10:00 EDT wall (delta from Sat 10:00 -> Sun 10:00 -> Mon 10:00).
    // With the dayShift branch we skip weekends to Monday 09:00 local.
    // Sat 10:00Local -> Mon 09:00 = wall-clock delta 47h.
    // In UTC: Sat 2026-06-20T14:00Z + 47h = Mon 2026-06-22T13:00Z (Mon 09:00 EDT).
    const now = new Date('2026-06-20T14:00:00Z');
    expect(nextBusinessHourSlot('America/New_York', now).toISOString()).toBe(
      '2026-06-22T13:00:00.000Z',
    );
  });

  it('handles Friday >= 17 local by rolling to Monday', () => {
    // Friday 2026-06-19T22:00Z = 18:00 EDT (post-cutoff).
    // dayShift = 3 -> Monday. delta = target9(9*3600) - localSec(18*3600) + 3*86400
    // = -32400 + 259200 = 226800s = 63h.
    // Friday 22:00Z + 63h = Monday 13:00Z (09:00 EDT).
    const now = new Date('2026-06-19T22:00:00Z');
    expect(nextBusinessHourSlot('America/New_York', now).toISOString()).toBe(
      '2026-06-22T13:00:00.000Z',
    );
  });
});
