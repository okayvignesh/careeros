import type { ReactNode } from 'react';
import type { AsyncState } from '@/lib/useAsync';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './ui';

/**
 * Renders exactly one of loading / error / empty / content for an `AsyncState`.
 * Every read screen uses this so the three states are never missed.
 */
export function AsyncView<T>({
  state,
  emptyMessage = 'Nothing here yet.',
  onRetry,
  children,
}: {
  state: AsyncState<T>;
  emptyMessage?: string;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.loading && state.data === null) return <LoadingBlock />;
  if (state.error !== null) {
    return <ErrorBlock message={state.error} onRetry={onRetry ?? state.reload} />;
  }
  if (state.data === null) return <EmptyBlock message={emptyMessage} />;
  return <>{children(state.data)}</>;
}
