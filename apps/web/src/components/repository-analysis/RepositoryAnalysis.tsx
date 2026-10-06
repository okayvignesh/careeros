'use client';

import { useCallback, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import type { RepositoryAnalysisResponse } from './types';
import { RepositoryAnalysisView } from './RepositoryAnalysisView';

export function RepositoryAnalysis() {
  const loader = useCallback(() => apiGet<RepositoryAnalysisResponse>('/repository-analysis'), []);
  const { data, error, loading, refetch } = useApi(loader);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const repos = data?.repos ?? [];
  const selectedRepo = repos.find((r) => r.repoId === selectedId) ?? repos[0] ?? null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await apiPost('/integrations/github/resync');
      await refetch();
    } catch {
      // The view already surfaces fetch errors; a failed queue call is transient
      // and refetch below will show the current (unchanged) state.
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return (
    <RepositoryAnalysisView
      data={data}
      loading={loading}
      error={error}
      selectedRepo={selectedRepo}
      onSelect={setSelectedId}
      onRefresh={onRefresh}
      onRetry={refetch}
      refreshing={refreshing}
    />
  );
}
