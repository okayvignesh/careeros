import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnavailableNotice } from './UnavailableNotice';

/**
 * A8 regression guard: the missing-endpoint state must be an explicit,
 * announced unavailable notice. If a fixture fallback is reintroduced this
 * component stops being what the panels render, and the "no fabricated data"
 * contract is lost; the markup assertions below keep the state honest.
 */
describe('UnavailableNotice', () => {
  it('renders an announced unavailable state', () => {
    const html = renderToStaticMarkup(
      createElement(UnavailableNotice, { feature: 'Skill demand' }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Skill demand isn’t available yet');
  });

  it('renders no fabricated data structures or figures', () => {
    const html = renderToStaticMarkup(
      createElement(UnavailableNotice, { feature: 'Trend signals' }),
    );
    // No table, rows, percentages, or history values can leak through the
    // unavailable state.
    expect(html).not.toContain('<table');
    expect(html).not.toContain('%');
    expect(html).not.toContain('data-testid="skill-demand-row"');
    expect(html).not.toContain('data-testid="trend-signal-row"');
    expect(html).not.toContain('data-testid="provider-card"');
  });

  it('honours a caller-supplied test id', () => {
    const html = renderToStaticMarkup(
      createElement(UnavailableNotice, { feature: 'Search providers', testId: 'providers-unavailable' }),
    );
    expect(html).toContain('data-testid="providers-unavailable"');
  });
});
