// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../../shared/db/schema';
import type {
  IntelligenceSnapshotDto,
  IntelligenceSnapshotEventDto,
} from '../../../../shared/ipc/schemas';
import { useIntelligence } from './use-intelligence';

const repository: Repository = {
  id: 'repository-1',
  githubRepoId: -1,
  ownerLogin: 'local',
  name: 'agentic-worktrees',
  fullName: 'local/agentic-worktrees',
  defaultBranch: 'main',
  isPrivate: false,
  isArchived: false,
  cloneUrl: '',
  sshUrl: null,
  htmlUrl: '',
  localRootPath: '/workspace/agentic-worktrees',
  localCloneStatus: 'ready',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

const snapshot = (id: string, stale = false): IntelligenceSnapshotDto => ({
  id,
  repositoryId: repository.id,
  startedAt: 1,
  completedAt: id === 'persisted' ? 2 : 3,
  stale,
  refreshError: null,
  warnings: [],
  worktrees: [],
  overlaps: [],
});

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

afterEach(() => vi.restoreAllMocks());

describe('useIntelligence', () => {
  it('publishes persisted data before a background refresh completes', async () => {
    const refresh = deferred<IntelligenceSnapshotDto>();
    let eventListener: ((event: IntelligenceSnapshotEventDto) => void) | undefined;
    const getSnapshot = vi.fn().mockResolvedValue(snapshot('persisted'));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        intelligence: {
          listRepositories: vi.fn().mockResolvedValue([repository]),
          getSnapshot,
          refresh: vi.fn(() => refresh.promise),
          onSnapshotChanged: vi.fn((listener) => {
            eventListener = listener;
            return () => undefined;
          }),
        },
      },
    });

    const { result } = renderHook(() => useIntelligence());

    await waitFor(() => expect(result.current.snapshot?.id).toBe('persisted'));
    expect(result.current.refreshing).toBe(true);

    await act(async () => refresh.resolve(snapshot('fresh')));
    await waitFor(() => expect(result.current.snapshot?.id).toBe('fresh'));

    getSnapshot.mockResolvedValueOnce(snapshot('event'));
    await act(async () => {
      eventListener?.({
        repositoryId: repository.id,
        snapshotId: 'event',
        completedAt: 4,
      });
    });
    await waitFor(() => expect(result.current.snapshot?.id).toBe('event'));
  });

  it('keeps persisted data and marks it stale when refresh fails', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        intelligence: {
          listRepositories: vi.fn().mockResolvedValue([repository]),
          getSnapshot: vi.fn().mockResolvedValue(snapshot('persisted')),
          refresh: vi.fn().mockRejectedValue(new Error('analysis failed')),
          onSnapshotChanged: vi.fn(() => () => undefined),
        },
      },
    });

    const { result } = renderHook(() => useIntelligence());

    await waitFor(() => expect(result.current.error).toBe('analysis failed'));
    expect(result.current.snapshot).toMatchObject({ id: 'persisted', stale: true });
  });
});
