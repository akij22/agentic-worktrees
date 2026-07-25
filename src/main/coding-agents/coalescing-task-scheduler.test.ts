import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoalescingTaskScheduler } from './coalescing-task-scheduler';

describe('CoalescingTaskScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs during a continuous event burst instead of resetting the delay', async () => {
    const task = vi.fn(async () => undefined);
    const scheduler = new CoalescingTaskScheduler(120, task);

    scheduler.request('run-1');
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(100);
      scheduler.request('run-1');
    }

    expect(task).toHaveBeenCalled();
    scheduler.clear();
  });

  it('serializes work per key and coalesces pending requests into one follow-up', async () => {
    const resolvers: Array<() => void> = [];
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          activeTasks += 1;
          maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
          resolvers.push(() => {
            activeTasks -= 1;
            resolve();
          });
        }),
    );
    const scheduler = new CoalescingTaskScheduler(120, task);

    scheduler.request('run-1');
    await vi.advanceTimersByTimeAsync(120);
    scheduler.request('run-1');
    scheduler.request('run-1');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(task).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(120);

    expect(task).toHaveBeenCalledTimes(2);
    expect(maxActiveTasks).toBe(1);
    resolvers.shift()?.();
    await Promise.resolve();
    scheduler.clear();
  });
});
