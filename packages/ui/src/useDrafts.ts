'use client';

// Tiny localStorage-backed draft store for in-flight editor content.
//
// - Reads once on mount (SSR-safe: guards `window` access).
// - Writes are debounced 300ms so a fast-typing user does not thrash
//   localStorage on every keystroke.
// - Keys are namespaced with a prefix so tests can wipe cleanly and so we
//   don't collide with other localStorage users.
//
// ponytail: single string value per key. Upgrade to structured drafts
// (cursor position, per-file tabs) when the arena actually needs them.

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'careeros:draft:';
const DEBOUNCE_MS = 300;

function hasStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.localStorage !== 'undefined';
  } catch {
    // e.g. private browsing may throw on access.
    return false;
  }
}

function readSync(key: string): string | null {
  if (!hasStorage()) return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writeSync(key: string, value: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Quota / disabled storage. Silent.
  }
}

function removeSync(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Silent.
  }
}

export interface UseDraftsResult {
  draft: string | null;
  saveDraft: (value: string) => void;
  clearDraft: () => void;
}

export function useDrafts(key: string): UseDraftsResult {
  // Start `null` on both server and client so SSR + hydration match. We hydrate
  // the real value in an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(readSync(key));
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [key]);

  const saveDraft = useCallback(
    (value: string) => {
      setDraft(value);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        writeSync(key, value);
        timer.current = null;
      }, DEBOUNCE_MS);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setDraft(null);
    removeSync(key);
  }, [key]);

  return { draft, saveDraft, clearDraft };
}
