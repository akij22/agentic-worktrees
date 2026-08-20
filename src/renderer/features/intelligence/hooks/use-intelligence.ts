import { useCallback, useEffect, useState } from 'react';
import type { Repository } from '../../../../shared/db/schema';
import type { IntelligenceSnapshotDto } from '../../../../shared/ipc/schemas';

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const useIntelligence = () => {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>();
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void window.api.intelligence.listRepositories()
      .then((values) => {
        if (cancelled) return;
        setRepositories(values);
        setSelectedRepositoryId((current) =>
          current && values.some(({ id }) => id === current)
            ? current
            : values[0]?.id);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedRepositoryId) return;
    setRefreshing(true);
    setError(undefined);
    try {
      setSnapshot(await window.api.intelligence.refresh({
        repositoryId: selectedRepositoryId,
      }));
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setSnapshot((current) => current
        ? { ...current, stale: true, refreshError: message }
        : current);
    } finally {
      setRefreshing(false);
    }
  }, [selectedRepositoryId]);

  useEffect(() => {
    if (!selectedRepositoryId) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setSnapshot(null);
    void window.api.intelligence.getSnapshot({ repositoryId: selectedRepositoryId })
      .then((persisted) => {
        if (!cancelled) setSnapshot(persisted);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        void refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, selectedRepositoryId]);

  useEffect(() => window.api.intelligence.onSnapshotChanged((event) => {
    if (event.repositoryId !== selectedRepositoryId) return;
    void window.api.intelligence.getSnapshot({ repositoryId: event.repositoryId })
      .then((persisted) => {
        if (persisted) {
          setSnapshot(persisted);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }), [selectedRepositoryId]);

  return {
    repositories,
    selectedRepositoryId,
    selectRepository: setSelectedRepositoryId,
    snapshot,
    loading,
    refreshing,
    error,
    refresh,
  };
};
