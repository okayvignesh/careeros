import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GapBadge } from './GapBadge';

/**
 * Component-level companion to `gap-tone.test.ts`: proves the tone/label
 * helpers are actually wired into the rendered badge. Same createElement +
 * renderToStaticMarkup pattern as Sparkline/DevicesPanel (no jsdom).
 */
describe('GapBadge', () => {
  it('renders the met label with success tone for a covered gap', () => {
    const html = renderToStaticMarkup(createElement(GapBadge, { gap: 0 }));
    expect(html).toContain('Met');
    expect(html).toContain('text-[hsl(var(--success))]');
    expect(html).toContain('tabular-nums');
  });

  it('renders Gap N with the warn tone at the warn boundary', () => {
    const html = renderToStaticMarkup(createElement(GapBadge, { gap: 15 }));
    expect(html).toContain('Gap 15');
    expect(html).toContain('text-[hsl(var(--warn))]');
  });

  it('renders the danger tone for wide gaps', () => {
    const html = renderToStaticMarkup(createElement(GapBadge, { gap: 45 }));
    expect(html).toContain('Gap 45');
    expect(html).toContain('text-[hsl(var(--danger))]');
  });
});
