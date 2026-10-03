import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Minimal fetch-state hook: loading / error / data + a `reload`. `deps` drive
 * re-fetching; `fn` is held in a ref so callers can pass an inline closure
 * without triggering an infinite fetch loop.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    // setState is deferred to a microtask so the effect body itself does not
    // trigger cascading renders (react-hooks/set-state-in-effect).
    Promise.resolve()
      .then(() => {
        if (alive) {
          setLoading(true);
          setError(null);
        }
        return fnRef.current();
      })
      .then((result) => {
        if (!alive) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload };
}
