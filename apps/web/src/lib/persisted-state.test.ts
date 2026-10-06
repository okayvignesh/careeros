import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalStore } from './persisted-state';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: fakeStorage(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
});

describe('createLocalStore', () => {
  it('returns the fallback initially and persists + notifies on set', () => {
    const store = createLocalStore<string[]>('test:nav', []);
    expect(store.get()).toEqual([]);
    expect(store.getServer()).toEqual([]);

    let notified = 0;
    const unsub = store.subscribe(() => {
      notified += 1;
    });

    store.set(['a', 'b']);
    expect(notified).toBe(1);
    expect(store.get()).toEqual(['a', 'b']);

    unsub();
    store.set(['c']);
    expect(notified).toBe(1); // unsubscribed
  });

  it('falls back on malformed JSON', () => {
    (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage.setItem(
      'bad',
      '{not json',
    );
    const store = createLocalStore<string[]>('bad', ['fallback']);
    expect(store.get()).toEqual(['fallback']);
  });
});
