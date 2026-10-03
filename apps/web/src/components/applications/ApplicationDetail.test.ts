import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplicationTimeline, type ApplicationEvent } from './ApplicationDetail';

/**
 * E2 component test: proves the application timeline wires event state,
 * actor and notes into the accessible markup. Same createElement +
 * renderToStaticMarkup pattern as DevicesPanel/Sparkline (no jsdom).
 */
const events: ApplicationEvent[] = [
  {
    id: 'e1',
    fromState: 'interested',
    toState: 'applied',
    byActor: 'user',
    notes: null,
    at: '2026-09-18T07:58:00.000Z',
  },
  {
    id: 'e2',
    fromState: 'applied',
    toState: 'interviewing',
    byActor: 'system',
    notes: 'Recruiter reached out',
    at: '2026-09-21T09:40:00.000Z',
  },
];

describe('ApplicationTimeline', () => {
  it('renders one row per event with from→to, actor and notes', () => {
    const html = renderToStaticMarkup(createElement(ApplicationTimeline, { events }));
    expect(html).toContain('data-testid="application-timeline"');
    expect((html.match(/data-testid="application-event"/g) ?? []).length).toBe(2);
    expect(html).toContain('Interested → Applied');
    expect(html).toContain('Applied → Interviewing');
    expect(html).toContain('user');
    expect(html).toContain('Recruiter reached out');
    expect(html).toContain('Timeline · 2 events');
  });

  it('renders the first event without a from-state and handles an empty log', () => {
    const first = renderToStaticMarkup(
      createElement(ApplicationTimeline, {
        events: [{ ...events[0]!, fromState: null, toState: 'interested' }],
      }),
    );
    expect(first).toContain('Interested');
    expect(first).not.toContain('→ Interested');

    const empty = renderToStaticMarkup(createElement(ApplicationTimeline, { events: [] }));
    expect(empty).toContain('No events recorded yet.');
    expect(empty).toContain('Timeline · 0 events');
  });
});
