import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sparkline } from './Sparkline';

/**
 * C1 render smoke test for a shipped component. `chart-geometry.test.ts` proves
 * the math; this proves the React shell actually wires it into an accessible
 * inline SVG. Same createElement + renderToStaticMarkup pattern as
 * UnavailableNotice.test.ts — `jsx: preserve` means a .tsx test can't be
 * imported by the node vitest run, so no jsdom / @testing-library needed.
 */
describe('Sparkline', () => {
  it('renders an announced rising trend as a polyline', () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [1, 2, 3], ariaLabel: 'Skill demand trend' }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Skill demand trend"');
    expect(html).toContain('<polyline');
    // Rising tone derives from trendDirection([1,2,3]).
    expect(html).toContain('hsl(var(--accent))');
  });

  it('renders no polyline for an empty series', () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [], ariaLabel: 'Trend unavailable' }),
    );
    expect(html).toContain('role="img"');
    expect(html).not.toContain('<polyline');
  });

  it('honours an explicit tone override over the derived one', () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [1, 2, 3], ariaLabel: 'Forced', tone: 'declining' }),
    );
    expect(html).toContain('hsl(var(--warn))');
    expect(html).not.toContain('hsl(var(--accent))');
  });
});
