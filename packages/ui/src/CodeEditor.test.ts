// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';

// next/dynamic in a test context should just synchronously return the
// underlying textarea stand-in. This side-steps the real Monaco bundle
// entirely (which we do NOT want to load in jsdom).
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, _opts: unknown): unknown => {
    // Return a component that mimics @monaco-editor/react's minimal API:
    // { value, onChange, onMount }. We ignore theme / language / options.
    return function MockMonaco(props: {
      value: string;
      onChange?: (v: string | undefined) => void;
    }): JSX.Element {
      return createElement('textarea', {
        'data-testid': 'mock-monaco',
        value: props.value,
        onChange: (e: { target: { value: string } }) => {
          props.onChange?.(e.target.value);
        },
      });
    };
  },
}));

// Import after the mock is registered.
import { CodeEditor } from './CodeEditor';

describe('CodeEditor', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders without crashing under jsdom', () => {
    const { getByTestId } = render(
      createElement(CodeEditor, { value: 'const x = 1;', onChange: () => {} }),
    );
    expect(getByTestId('careeros-code-editor')).toBeTruthy();
    expect(getByTestId('mock-monaco')).toBeTruthy();
  });

  it('bubbles onChange from the underlying editor', () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      createElement(CodeEditor, { value: 'start', onChange }),
    );
    const ta = getByTestId('mock-monaco') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'updated' } });
    expect(onChange).toHaveBeenCalledWith('updated');
  });

  it('applies the configured height to the wrapper', () => {
    const { getByTestId } = render(
      createElement(CodeEditor, {
        value: '',
        onChange: () => {},
        height: 250,
      }),
    );
    const wrapper = getByTestId('careeros-code-editor') as HTMLDivElement;
    expect(wrapper.style.height).toBe('250px');
  });
});
