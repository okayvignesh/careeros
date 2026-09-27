// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useDrafts } from './useDrafts';

describe('useDrafts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('starts null then hydrates from localStorage on mount', () => {
    window.localStorage.setItem('careeros:draft:k1', 'prior');
    const { result } = renderHook(() => useDrafts('k1'));
    expect(result.current.draft).toBe('prior');
  });

  it('saveDraft updates in-memory value immediately and writes after 300ms debounce', () => {
    const { result } = renderHook(() => useDrafts('k2'));
    act(() => {
      result.current.saveDraft('hello');
    });
    // In-memory value flips instantly.
    expect(result.current.draft).toBe('hello');
    // But localStorage has not been touched yet.
    expect(window.localStorage.getItem('careeros:draft:k2')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(window.localStorage.getItem('careeros:draft:k2')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(window.localStorage.getItem('careeros:draft:k2')).toBe('hello');
  });

  it('coalesces rapid saves into a single write', () => {
    const { result } = renderHook(() => useDrafts('k3'));
    act(() => {
      result.current.saveDraft('a');
      result.current.saveDraft('ab');
      result.current.saveDraft('abc');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Only the last value ends up persisted.
    expect(window.localStorage.getItem('careeros:draft:k3')).toBe('abc');
  });

  it('clearDraft cancels a pending save and wipes storage', () => {
    window.localStorage.setItem('careeros:draft:k4', 'existing');
    const { result } = renderHook(() => useDrafts('k4'));
    // Confirm hydrated.
    expect(result.current.draft).toBe('existing');
    act(() => {
      result.current.saveDraft('new-value');
      result.current.clearDraft();
    });
    expect(result.current.draft).toBeNull();
    expect(window.localStorage.getItem('careeros:draft:k4')).toBeNull();
    // Even after debounce fires, nothing lands.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(window.localStorage.getItem('careeros:draft:k4')).toBeNull();
  });

  it('namespaces keys so unrelated localStorage entries survive', () => {
    window.localStorage.setItem('other:unrelated', 'keep');
    const { result } = renderHook(() => useDrafts('k5'));
    act(() => {
      result.current.saveDraft('x');
      result.current.clearDraft();
    });
    expect(window.localStorage.getItem('other:unrelated')).toBe('keep');
  });
});
