import { describe, expect, it } from 'vitest';
import { skillDemandView, trendSignalsView } from './market-data';

/**
 * Web-side logic test: the components trust this boundary to normalize the
 * real API envelopes. A malformed payload must throw (so the panel shows the
 * unavailable notice) and empty data must stay empty (not become a fixture).
 */
describe('skillDemandView', () => {
  const row = {
    skillId: 'ts',
    label: 'TypeScript',
    cluster: 'frontend',
    postings: 2,
    share: 0.5,
    history: [1, 0, 0, 0, 0, 0, 1],
    gap: 12,
  };

  it('returns the rows and derives cluster options alphabetically', () => {
    const out = skillDemandView({
      windowDays: 30,
      rows: [row, { ...row, skillId: 'k8s', cluster: 'cloud' }],
    });
    expect(out.windowDays).toBe(30);
    expect(out.rows).toHaveLength(2);
    expect(out.clusters).toEqual(['cloud', 'frontend']);
  });

  it('keeps an empty result empty', () => {
    expect(skillDemandView({ windowDays: 30, rows: [] })).toEqual({
      windowDays: 30,
      rows: [],
      clusters: [],
    });
  });

  it('throws on a malformed payload so the panel can go unavailable', () => {
    expect(() => skillDemandView({ windowDays: 30 })).toThrow();
    expect(() => skillDemandView([])).toThrow();
  });
});

describe('trendSignalsView', () => {
  it('validates and returns the signal envelope', () => {
    const out = trendSignalsView({
      generatedAt: '2026-10-02T00:00:00.000Z',
      signals: [
        {
          id: 'qdrant',
          technology: 'Qdrant',
          category: 'data',
          mentions: 12,
          sources: 3,
          firstSeen: '2026-08-01',
          trajectory: 'rising',
          history: [0, 1, 2, 3, 4, 2, 0],
        },
      ],
    });
    expect(out.signals[0]!.trajectory).toBe('rising');
  });

  it('rejects an unknown trajectory', () => {
    expect(() =>
      trendSignalsView({ generatedAt: 'x', signals: [{ trajectory: 'exploding' }] }),
    ).toThrow();
  });
});
