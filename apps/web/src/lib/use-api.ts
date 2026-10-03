'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type ApiSetter<T> = Dispatch<SetStateAction<T | null>>;

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  setData: ApiSetter<T>;
  setError: ApiSetter<string>;
  /** Re-run `loader` imperatively. Returns once state has settled. */
  refetch: () => Promise<void>;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Fetch-on-mount store for the common `{ data, error, loading }` panel shape.
 *
 * The mount effect attaches promise callbacks rather than invoking a
 * setState-bearing function synchronously, so it satisfies
 * `react-hooks/set-state-in-effect` without weakening the rule.
 *
 * `loader` must be stable (`useCallback`): its identity is the effect's only
 * dependency, so an inline loader would refetch every render.
 */
export function useApi<T>(loader: () => Promise<T>): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loader()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loader]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      setData(result);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [loader]);

  return { data, error, loading, setData, setError, refetch };
}
