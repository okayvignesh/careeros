import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerbalRunner } from './VerbalRunner';

/**
 * Render smoke test for the runner with a stubbed MediaRecorder + fetch.
 * Server rendering skips effects, so no request is issued — the assertion on
 * the fetch spy proves the test never hits the network, and the import path
 * proves the component does not touch `MediaRecorder` at module scope.
 */
afterEach(() => vi.unstubAllGlobals());

describe('VerbalRunner', () => {
  it('renders its loading skeleton without touching the network', () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network disabled in test')));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported() {
          return true;
        }
      },
    );
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
    });

    const html = renderToStaticMarkup(createElement(VerbalRunner, {}));
    expect(html).toContain('animate-pulse');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
