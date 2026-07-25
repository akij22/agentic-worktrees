import { describe, expect, it, vi } from "vitest";
import { CoalescingTaskQueue } from "./coalescing-task-queue";

describe("CoalescingTaskQueue", () => {
  it("serializes refreshes and drains a burst as one follow-up request", async () => {
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
    const queue = new CoalescingTaskQueue(task);

    const drained = queue.request();
    void queue.request();
    void queue.request();

    expect(task).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);

    resolvers.shift()?.();
    await drained;

    expect(task).toHaveBeenCalledTimes(2);
    expect(maxActiveTasks).toBe(1);
  });

  it("can run again after a failed refresh", async () => {
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce(undefined);
    const queue = new CoalescingTaskQueue(task);

    await expect(queue.request()).rejects.toThrow("refresh failed");
    await expect(queue.request()).resolves.toBeUndefined();

    expect(task).toHaveBeenCalledTimes(2);
  });
});
