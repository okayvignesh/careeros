import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VerbalSessionView } from '@/lib/verbal-assessments';
import { VerbalSessionsList } from './VerbalSessionsList';

function session(overrides: Partial<VerbalSessionView>): VerbalSessionView {
  return {
    id: 's1',
    questionId: 'q1',
    prompt: 'Explain the virtual DOM.',
    skillIds: ['react'],
    difficulty: 'medium',
    status: 'created',
    audioKey: null,
    audioMime: null,
    language: null,
    transcript: null,
    segments: null,
    score: null,
    reasoning: null,
    attemptId: null,
    durationMs: null,
    error: null,
    createdAt: '2026-10-04T08:00:00.000Z',
    transcribedAt: null,
    gradedAt: null,
    ...overrides,
  };
}

describe('VerbalSessionsList', () => {
  it('renders an intentional empty state', () => {
    const html = renderToStaticMarkup(createElement(VerbalSessionsList, { sessions: [] }));
    expect(html).toContain('data-testid="verbal-history-empty"');
  });

  it('shows the real score and a link for a graded session', () => {
    const html = renderToStaticMarkup(
      createElement(VerbalSessionsList, {
        sessions: [
          session({ id: 's2', status: 'graded', score: 0.82, attemptId: 'a9', transcript: 'I said…' }),
        ],
      }),
    );
    expect(html).toContain('data-testid="verbal-history-row"');
    expect(html).toContain('82%');
    expect(html).toContain('/arena/results/a9');
  });

  it('does not fabricate a score for unavailable or failed sessions', () => {
    const html = renderToStaticMarkup(
      createElement(VerbalSessionsList, {
        sessions: [
          session({ id: 's3', status: 'unavailable', error: 'whisper not configured' }),
          session({ id: 's4', status: 'failed', error: 'upstream 500' }),
        ],
      }),
    );
    expect(html).toContain('Speech-to-text unavailable');
    expect(html).toContain('Transcription failed');
    expect(html).toContain('no score');
    expect(html).not.toContain('%');
  });
});
