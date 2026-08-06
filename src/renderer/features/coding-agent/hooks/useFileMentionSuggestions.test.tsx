// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../../shared/ipc/api';
import type { ActiveFileMention } from '../lib/file-mentions';
import { useFileMentionSuggestions } from './useFileMentionSuggestions';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const mention = (query: string): ActiveFileMention => ({
  start: 4,
  end: 5 + query.length,
  query,
});

describe('useFileMentionSuggestions', () => {
  const search = vi.fn<Api['workspace']['files']['search']>();

  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: { files: { search } },
      } as unknown as Api,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads bounded suggestions after the debounce', async () => {
    const request = deferred<string[]>();
    search.mockReturnValueOnce(request.promise);
    const { result } = renderHook(() =>
      useFileMentionSuggestions({
        worktreeId: 'worktree-1',
        mention: mention('sess'),
      }),
    );

    expect(result.current).toMatchObject({ loading: true, paths: [] });
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(search).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      query: 'sess',
      limit: 20,
    });

    await act(async () => {
      request.resolve(['src/Session.tsx']);
      await request.promise;
    });
    expect(result.current).toEqual({
      paths: ['src/Session.tsx'],
      loading: false,
      error: undefined,
    });
  });

  it('ignores an older response after the mention changes', async () => {
    const oldRequest = deferred<string[]>();
    const newRequest = deferred<string[]>();
    search
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { result, rerender } = renderHook(
      ({ activeMention }: { activeMention?: ActiveFileMention }) =>
        useFileMentionSuggestions({
          worktreeId: 'worktree-1',
          mention: activeMention,
        }),
      { initialProps: { activeMention: mention('old') } },
    );

    await act(async () => vi.advanceTimersByTime(100));
    rerender({ activeMention: mention('new') });
    await act(async () => vi.advanceTimersByTime(100));

    await act(async () => {
      newRequest.resolve(['new.ts']);
      await newRequest.promise;
    });
    await act(async () => {
      oldRequest.resolve(['old.ts']);
      await oldRequest.promise;
    });

    expect(result.current.paths).toEqual(['new.ts']);
  });

  it('surfaces search errors and clears state without an active mention', async () => {
    const request = deferred<string[]>();
    search.mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(
      ({ activeMention }: { activeMention?: ActiveFileMention }) =>
        useFileMentionSuggestions({
          worktreeId: 'worktree-1',
          mention: activeMention,
        }),
      {
        initialProps: {
          activeMention: mention('fail'),
        } as { activeMention: ActiveFileMention | undefined },
      },
    );

    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => {
      request.reject(new Error('Search failed'));
      await request.promise.catch(() => undefined);
    });
    expect(result.current).toEqual({
      paths: [],
      loading: false,
      error: 'Search failed',
    });

    rerender({ activeMention: undefined });
    expect(result.current).toEqual({
      paths: [],
      loading: false,
      error: undefined,
    });
  });
});
