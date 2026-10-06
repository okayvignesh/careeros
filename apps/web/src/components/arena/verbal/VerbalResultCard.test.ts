import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AttemptResult } from '@/lib/verbal-assessments';
import { VerbalResultCard } from './VerbalResultCard';

function result(overrides: Partial<AttemptResult> = {}): AttemptResult {
  return {
    attemptId: 'a1',
    score: 0.8,
    hits: ['technical 90%', 'communication 70%', 'virtual DOM', 'keys'],
    misses: ['reconciliation cost'],
    reasoning: 'Strong, structured answer.',
    xpAwarded: 50,
    totalXp: 500,
    level: { level: 4, xpInLevel: 10, xpToNext: 40, totalXp: 500 },
    previousLevel: 4,
    leveledUp: false,
    streakDays: 3,
    skillDeltas: [],
    ...overrides,
  };
}

describe('VerbalResultCard', () => {
  it('shows the real score, both dimensions, and the key points', () => {
    const html = renderToStaticMarkup(createElement(VerbalResultCard, { result: result() }));
    expect(html).toContain('data-testid="verbal-result"');
    expect(html).toContain('80%');
    expect(html).toContain('90%'); // technicalAccuracy lifted from the real hits
    expect(html).toContain('70%'); // communication
    // Dimension summary lines are consumed, not repeated as key-point hits.
    expect(html).toContain('virtual DOM');
    expect(html).not.toContain('technical 90%');
    expect(html).not.toContain('communication 70%');
    expect(html).toContain('reconciliation cost');
    expect(html).toContain('Strong, structured answer.');
  });

  it('renders "not scored" instead of a fabricated dimension', () => {
    const html = renderToStaticMarkup(
      createElement(VerbalResultCard, { result: result({ hits: ['only a key point'] }) }),
    );
    expect(html).toContain('not scored');
    expect(html).not.toContain('technical 0%');
  });

  it('announces a level-up only when the real result carries one', () => {
    const leveled = renderToStaticMarkup(
      createElement(VerbalResultCard, { result: result({ leveledUp: true }) }),
    );
    expect(leveled).toContain('Level up');
    const notLeveled = renderToStaticMarkup(
      createElement(VerbalResultCard, { result: result({ leveledUp: false }) }),
    );
    expect(notLeveled).not.toContain('Level up');
  });
});
