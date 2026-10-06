'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tiny localStorage-backed external store, read through `useSyncExternalStore`
 * so server render and client hydration both use the fallback (no mismatch),
 * then the client switches to the persisted value after hydration.
 *
 * `get()` returns a cached reference for an unchanged raw string, so React's
 * identity check doesn't loop.
 */
export interface LocalStore<T> {
  get(): T;
  getServer(): T;
  set(value: T): void;
  subscribe(cb: () => void): () => void;
}

export function createLocalStore<T>(key: string, fallback: T): LocalStore<T> {
  let cachedRaw: string | null | undefined;
  let cached: T = fallback;
  const listeners = new Set<() => void>();

  function read(): T {
    if (typeof window === 'undefined') return fallback;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (raw == null) {
      cached = fallback;
      return cached;
    }
    try {
      cached = JSON.parse(raw) as T;
    } catch {
      cached = fallback;
    }
    return cached;
  }

  return {
    get: read,
    getServer: () => fallback,
    set(value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage disabled — keep in-memory behaviour */
      }
      cachedRaw = undefined; // force the next read to parse the new value
      for (const l of listeners) l();
    },
    subscribe(cb) {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) {
          cachedRaw = undefined;
          cb();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}

export function useLocalStore<T>(store: LocalStore<T>): [T, (v: T) => void] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return [value, store.set];
}
